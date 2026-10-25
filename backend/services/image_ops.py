"""Image ingest + feature extraction used by the offline (keyless) analysis path."""

from __future__ import annotations

import hashlib
import io
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_EDGE = 1280
ANALYSIS_EDGE = 448


class ImageDecodeError(ValueError):
    """Raised when uploaded bytes are not a decodable raster image."""


@dataclass(slots=True)
class ImageFeatures:
    width: int
    height: int
    brightness: float  # 0..1 mean luminance
    contrast: float  # 0..1 luminance std-dev
    saturation: float  # 0..1 mean saturation
    sharpness: float  # 0..1 normalised Laplacian energy
    hi_vis_ratio: float  # fraction of pixels in hi-vis yellow/orange/lime band
    skin_ratio: float  # fraction of pixels in skin-tone band
    dark_ratio: float  # fraction of pixels with very low luminance
    blue_ratio: float  # fraction of pixels in industrial-blue band (helmets/containers)
    edge_density: float  # fraction of pixels on an ABSOLUTE strong gradient ridge
    crack_density: float  # fraction of pixels flagged as thin dark line-like features
    crack_coherence: float  # 0..1 how strongly those dark features align into lines
    crack_spread: float  # 0..1 fraction of the 4x4 grid carrying significant crack activity
    ridge_linearity: float  # 0..1 how line-like the strong edges are
    dominant_angle_deg: float  # 0..180 dominant ridge orientation
    material_density: float  # fraction of mid-contrast cluttered texture (stored material)
    zone_density: list[list[float]] = field(default_factory=list)  # 4x4 grid of edge density
    crack_cells: list[tuple[float, float, float, float, float]] = field(default_factory=list)
    seed: int = 0
    image: Image.Image | None = None

    @property
    def megapixels(self) -> float:
        return round(self.width * self.height / 1_000_000, 2)


def _to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorised RGB[0..1] -> H[0..360), S[0..1], V[0..1]."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    diff = mx - mn
    v = mx
    s = np.where(mx > 1e-6, diff / np.maximum(mx, 1e-6), 0.0)

    h = np.zeros_like(mx)
    mask = diff > 1e-6
    rmask = mask & (mx == r)
    gmask = mask & (mx == g) & ~rmask
    bmask = mask & (mx == b) & ~rmask & ~gmask
    h[rmask] = ((g[rmask] - b[rmask]) / diff[rmask]) % 6
    h[gmask] = (b[gmask] - r[gmask]) / diff[gmask] + 2
    h[bmask] = (r[bmask] - g[bmask]) / diff[bmask] + 4
    h *= 60.0
    return h, s, v


def _erode(a: np.ndarray, k: int = 5) -> np.ndarray:
    """Separable greyscale erosion with a k x k square structuring element."""
    out = a.copy()
    r = k // 2
    for axis in (0, 1):
        acc = out.copy()
        for shift in range(-r, r + 1):
            if shift == 0:
                continue
            acc = np.minimum(acc, np.roll(out, shift, axis=axis))
        out = acc
    return out


def _dilate(a: np.ndarray, k: int = 5) -> np.ndarray:
    out = a.copy()
    r = k // 2
    for axis in (0, 1):
        acc = out.copy()
        for shift in range(-r, r + 1):
            if shift == 0:
                continue
            acc = np.maximum(acc, np.roll(out, shift, axis=axis))
        out = acc
    return out


def _closing(gray: np.ndarray, k: int = 5) -> np.ndarray:
    """Greyscale closing = erode(dilate(x)). Closing is *extensive*: closing >= x.

    (Opening is the other order: dilate(erode(x)) <= x. Getting these inverted makes
    the black-hat uniformly negative and silently destroys the crack signal.)
    """
    return _erode(_dilate(gray, k), k)


def _blackhat(gray: np.ndarray, k: int = 5) -> np.ndarray:
    """Morphological black-hat: highlights thin DARK structures (cracks, joints, rebar).

    The closing fills dark features narrower than the structuring element; subtracting
    the original isolates exactly those features. Far more discriminative than raw
    edge magnitude, which fires on every sharp boundary whether or not it is a crack.
    """
    return np.clip(_closing(gray, k) - gray, 0.0, 1.0)


def _sobel(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (magnitude, orientation_rad) of a Sobel gradient."""
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = (gray[:, 2:] - gray[:, :-2]) * 0.5
    gy[1:-1, :] = (gray[2:, :] - gray[:-2, :]) * 0.5
    mag = np.hypot(gx, gy)
    ang = np.arctan2(gy, gx)
    return mag, ang


def decode_image(raw: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageDecodeError("file is not a readable JPEG/PNG/WebP image") from exc
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        background = Image.new("RGB", img.size, (17, 24, 39))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1])
            img = background
        else:
            img = img.convert("RGB")
    return img.convert("RGB")


def encode_jpeg(img: Image.Image, max_edge: int = MAX_EDGE, quality: int = 88) -> bytes:
    out = img.copy()
    out.thumbnail((max_edge, max_edge), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def extract_features(img: Image.Image, raw_bytes: bytes) -> ImageFeatures:
    """Compute the descriptor set that primes both heuristic engines."""
    work = img.copy()
    work.thumbnail((ANALYSIS_EDGE, ANALYSIS_EDGE), Image.LANCZOS)
    arr = np.asarray(work, dtype=np.float32) / 255.0

    lum = arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114
    brightness = float(lum.mean())
    contrast = float(min(1.0, lum.std() / 0.30))

    h, s, v = _to_hsv(arr)
    saturation = float(s.mean())

    lap = np.abs(
        -4 * lum[1:-1, 1:-1]
        + lum[:-2, 1:-1]
        + lum[2:, 1:-1]
        + lum[1:-1, :-2]
        + lum[1:-1, 2:]
    )
    sharpness = float(min(1.0, lap.mean() * 12.0))

    hi_vis_band = (
        ((h >= 18) & (h <= 75))
        | ((h >= 75) & (h <= 95) & (s > 0.55))
        | ((h >= 0) & (h <= 18) & (s > 0.70) & (v > 0.60))
    )
    hi_vis = hi_vis_band & (s > 0.45) & (v > 0.40)
    hi_vis_ratio = float(hi_vis.mean())

    skin_band = (((h >= 0) & (h <= 28)) | (h >= 340)) & (s > 0.15) & (s < 0.72) & (v > 0.25) & (v < 0.98)
    skin_ratio = float(skin_band.mean())

    dark_ratio = float((lum < 0.12).mean())
    # Industrial blue only: exclude pale sky (high value, low saturation).
    blue_band = (h >= 195) & (h <= 245) & (s > 0.38) & (v > 0.12) & (v < 0.62)
    blue_ratio = float(blue_band.mean())

    mag, ang = _sobel(lum)

    # --- structural edges: ABSOLUTE threshold -------------------------------------
    # (A percentile threshold is self-normalising and therefore carries no signal:
    #  it always marks the same fraction of pixels as "edges".)
    EDGE_THR = 0.085
    edges = mag > EDGE_THR
    edge_density = float(edges.mean())

    if edges.any():
        angles = ang[edges]
        cos2 = float(np.mean(np.cos(2 * angles)))
        sin2 = float(np.mean(np.sin(2 * angles)))
        linearity = float(math.hypot(cos2, sin2))
        # Mean gradient orientation is perpendicular to the ridge itself. Rotate by 90
        # so the reported angle is the *crack* orientation a surveyor would measure.
        dominant_angle = ((0.5 * math.atan2(sin2, cos2) * 180.0 / math.pi) + 90.0) % 180.0
    else:
        linearity = 0.0
        dominant_angle = 0.0

    # --- crack candidates: thin dark linear features -------------------------------
    bh = _blackhat(lum, k=5)
    CRACK_THR = 0.09
    crack_mask = bh > CRACK_THR
    crack_density = float(crack_mask.mean())

    crack_coherence = 0.0
    if crack_mask.sum() > 60:
        g_bh, a_bh = _sobel(bh)
        strong = crack_mask & (g_bh > 0.02)
        if strong.sum() > 60:
            # Weight by black-hat intensity so the deep, unambiguous crack dominates
            # faint aggregate speckle. Unweighted averaging is dragged toward zero by
            # hundreds of randomly-oriented texture pixels and reports "chaotic" for
            # what is visibly a single clean crack.
            w = bh[strong].astype(np.float64)
            w = w / max(w.sum(), 1e-9)
            angles_s = a_bh[strong]
            cos2b = float(np.sum(w * np.cos(2 * angles_s)))
            sin2b = float(np.sum(w * np.sin(2 * angles_s)))
            crack_coherence = float(min(1.0, math.hypot(cos2b, sin2b) * 1.25))
            # Store the crack orientation itself (perpendicular to the black-hat gradient)
            if crack_coherence > linearity:
                dominant_angle = ((0.5 * math.atan2(sin2b, cos2b) * 180.0 / math.pi) + 90.0) % 180.0

    # --- cluttered texture (stored material / housekeeping signal) ------------------
    mid_band = (mag > 0.045) & (mag <= EDGE_THR)
    material_density = float(mid_band.mean())

    # --- 4x4 spatial grid: where the crack-like ridges concentrate ------------------
    gh, gw = 4, 4
    zone_density: list[list[float]] = []
    cells: list[tuple[float, float, float, float, float]] = []
    H, W = edges.shape
    ridge_map = np.where(crack_mask, 1.0, 0.0) * 0.75 + np.where(edges, 1.0, 0.0) * 0.25
    for gy in range(gh):
        row: list[float] = []
        for gx in range(gw):
            y0, y1 = int(gy * H / gh), int((gy + 1) * H / gh)
            x0, x1 = int(gx * W / gw), int((gx + 1) * W / gw)
            cell = ridge_map[y0:y1, x0:x1]
            density = float(cell.mean()) if cell.size else 0.0
            row.append(round(density, 5))
            cells.append(
                (
                    round(x0 / W, 4),
                    round(y0 / H, 4),
                    round((x1 - x0) / W, 4),
                    round((y1 - y0) / H, 4),
                    round(density, 6),
                )
            )
        zone_density.append(row)

    # Spatial spread: a single directed crack lights up a narrow band of grid cells,
    # whereas map cracking / craze networks cover the whole surface. This is a stronger
    # discriminator than orientation coherence, which collides with aggregate texture.
    cell_scores = [c[4] for c in cells]
    peak = max(cell_scores) if cell_scores else 0.0
    active = sum(1 for score in cell_scores if score > max(peak * 0.45, 0.004))
    crack_spread = active / max(len(cell_scores), 1)

    seed = int(hashlib.sha256(raw_bytes[:65536]).hexdigest()[:8], 16)

    return ImageFeatures(
        width=img.width,
        height=img.height,
        brightness=round(brightness, 4),
        contrast=round(contrast, 4),
        saturation=round(saturation, 4),
        sharpness=round(sharpness, 4),
        hi_vis_ratio=round(hi_vis_ratio, 5),
        skin_ratio=round(skin_ratio, 5),
        dark_ratio=round(dark_ratio, 5),
        blue_ratio=round(blue_ratio, 5),
        edge_density=round(edge_density, 5),
        crack_density=round(crack_density, 5),
        crack_coherence=round(crack_coherence, 4),
        crack_spread=round(crack_spread, 4),
        ridge_linearity=round(linearity, 4),
        dominant_angle_deg=round(dominant_angle, 1),
        material_density=round(material_density, 5),
        zone_density=zone_density,
        crack_cells=cells,
        seed=seed,
        image=img,
    )
