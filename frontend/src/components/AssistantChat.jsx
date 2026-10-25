import { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  Bot,
  CornerDownLeft,
  FileText,
  Library,
  Loader2,
  Send,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { useViewMode } from '../lib/viewMode';
import { simpleChatAnswer } from '../lib/plainEnglish';
import { Button, Card, CardHeader, EngineFooter, ErrorState, TextArea } from './ui/Primitives';

const SUGGESTIONS = [
  'What is the maximum crack width allowed for severe exposure?',
  'How do I protect workers from heat stress in summer?',
  'How often must a scaffold be inspected?',
  'What are the hot-weather concreting precautions?',
  'What does RERA require for escrow of buyer payments?',
  'How deep can a trench be before shoring is required?',
];

const GREETING = {
  role: 'assistant',
  content:
    'Ask me anything covered by the platform’s standards corpus — IS 456, ACI 224 / 305 / 306, OSHA 1926, NBC 2016, RERA and industry guidance. Every answer cites the source extract so you can verify it before acting on it.',
  citations: [],
  follow_ups: SUGGESTIONS.slice(0, 3),
  grounded: true,
  engine: null,
};

/* Simple View speaks like a colleague on site, not a retrieval system. */
const GREETING_SIMPLE = {
  role: 'assistant',
  content:
    'Hello. Ask me anything about site safety, concrete, cracks or building rules — I answer in plain language and tell you where the answer comes from.',
  citations: [],
  follow_ups: [
    'How do I keep workers safe in extreme heat?',
    'Is this crack serious?',
    'How long should concrete be cured?',
  ],
  grounded: true,
  engine: null,
};

const PLAIN_SUGGESTIONS = [
  'How do I keep workers safe in extreme heat?',
  'How long should concrete be cured?',
  'When can I remove formwork?',
  'What safety gear is compulsory on site?',
  'How do I stop rain damaging a fresh pour?',
];

export default function AssistantChat({ onRequireBackend }) {
  const { isSimple } = useViewMode();
  const [messages, setMessages] = useState([isSimple ? GREETING_SIMPLE : GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeCitation, setActiveCitation] = useState(null);
  const [corpusOpen, setCorpusOpen] = useState(false);
  const [corpus, setCorpus] = useState(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  // Scroll behaviour: bring the START of a new answer into view (long RAG answers
  // would otherwise open mid-sentence), but follow the bottom while thinking.
  useEffect(() => {
    if (loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return;
    }
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && messages.length > 1) {
      const nodes = scrollRef.current?.querySelectorAll('[data-message]');
      nodes?.[nodes.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messages, loading]);

  const loadCorpus = async () => {
    setCorpusOpen((v) => !v);
    if (corpus || corpusOpen) return;
    try {
      setCorpus(await api.corpus());
    } catch {
      setCorpus({ count: 0, documents: [] });
    }
  };

  const send = async (question) => {
    const text = (question ?? input).trim();
    if (text.length < 3 || loading) return;

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const data = await api.assistant({ question: text, history, top_k: 5 });
      // The API contract calls the body `answer`; the message model calls it `content`.
      setMessages((m) => [...m, { role: 'assistant', ...data, content: data.answer }]);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.status === 0) onRequireBackend?.();
    } finally {
      setLoading(false);
    }
  };

  const thread = (
      <Card
        className={`flex h-[calc(100vh-8.5rem)] min-h-[520px] flex-col overflow-hidden ${
          isSimple ? '!rounded-2xl shadow-soft' : ''
        }`}
      >
        {isSimple ? (
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-white">
              <Bot size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold leading-tight text-slate-900">Site assistant</p>
              <p className="flex items-center gap-1.5 text-[11px] leading-tight text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online · answers in plain English
              </p>
            </div>
          </div>
        ) : (
          <CardHeader
            icon={Bot}
            title="Construction knowledge assistant"
            subtitle="Retrieval-augmented answers grounded in a curated standards corpus"
            action={
              <Button variant="secondary" size="sm" icon={Library} onClick={loadCorpus}>
                {corpusOpen ? 'Hide corpus' : 'View corpus'}
              </Button>
            }
          />
        )}

        <div
          ref={scrollRef}
          className={`flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5 ${isSimple ? 'bg-slate-50/60' : ''}`}
        >
          {messages.map((message, i) => (
            <div key={i} data-message={message.role}>
              <Bubble message={message} onCite={setActiveCitation} onFollowUp={send} simple={isSimple} />
            </div>
          ))}
          <div ref={bottomRef} />

          {loading ? (
            isSimple ? (
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
                  <Bot size={14} />
                </span>
                <span className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-2.5">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                      style={{ animationDelay: `${dot * 0.12}s`, animationDuration: '0.9s' }}
                    />
                  ))}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin text-accent-600" />
                Retrieving corpus chunks and composing an answer…
              </div>
            )
          ) : null}

          {error ? (
            <ErrorState
              error={error}
              onRetry={() => {
                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                if (lastUser) send(lastUser.content);
              }}
            />
          ) : null}
        </div>

        <div className={`border-t p-3 ${isSimple ? 'border-slate-100 bg-white' : 'border-slate-200'}`}>
          <div className="flex items-end gap-2">
            <TextArea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={isSimple ? 'Type your question…' : 'Ask about a standard or site practice…'}
              className={`max-h-28 min-h-[46px] resize-none leading-snug ${isSimple ? '!rounded-2xl' : ''}`}
              disabled={loading}
            />
            {isSimple ? (
              <button
                type="button"
                onClick={() => send()}
                disabled={loading || input.trim().length < 3}
                aria-label="Send question"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-600 text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {loading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
              </button>
            ) : (
              <Button
                onClick={() => send()}
                disabled={loading || input.trim().length < 3}
                icon={loading ? undefined : Send}
                className="h-10 shrink-0"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : 'Send'}
              </Button>
            )}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
            <CornerDownLeft size={10} />{' '}
            {isSimple ? 'Press Enter to send · answers are guidance, not a substitute for the code.' : 'Enter to send · Shift+Enter for a new line'}
          </p>
        </div>
      </Card>
  );

  if (isSimple) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.length === 1 ? (
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {PLAIN_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-[12px] font-medium text-slate-600 shadow-soft transition hover:border-accent-300 hover:text-accent-700"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {thread}
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      {thread}

      <div className="space-y-4">
        {corpusOpen ? (
          <Card>
            <CardHeader
              icon={Library}
              title="Indexed corpus"
              subtitle={corpus ? `${corpus.count} documents` : 'Loading…'}
              action={
                <button
                  type="button"
                  onClick={() => setCorpusOpen(false)}
                  className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100"
                  aria-label="Hide corpus"
                >
                  <X size={13} />
                </button>
              }
            />
            <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
              {(corpus?.documents ?? []).map((doc) => (
                <li key={doc.doc_id} className="px-4 py-2.5">
                  <p className="flex items-center gap-1.5 font-mono text-[9.5px] text-accent-700">
                    <FileText size={10} /> {doc.doc_id}
                  </p>
                  <p className="mt-0.5 text-[11.5px] font-medium leading-snug text-slate-800">{doc.title}</p>
                  <p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{doc.standard_code}</p>
                </li>
              ))}
              {corpus && corpus.count === 0 ? (
                <li className="px-4 py-6 text-center text-[11px] text-slate-400">Corpus unavailable.</li>
              ) : null}
            </ul>
          </Card>
        ) : (
          <Card>
            <CardHeader icon={Sparkles} title="Try asking" subtitle="Common site-engineer questions" />
            <ul className="space-y-1.5 p-3">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    disabled={loading}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-[11.5px] leading-snug text-slate-600 transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800 disabled:opacity-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {activeCitation ? (
          <Card>
            <CardHeader
              icon={BookMarked}
              title={activeCitation.doc_id}
              subtitle={activeCitation.standard_code}
              action={
                <button
                  type="button"
                  onClick={() => setActiveCitation(null)}
                  className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100"
                  aria-label="Close citation"
                >
                  <X size={13} />
                </button>
              }
            />
            <div className="p-4">
              <p className="text-[12px] font-semibold leading-snug text-slate-900">{activeCitation.title}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{activeCitation.section}</p>
              <p className="mt-2 border-l-2 border-accent-200 pl-3 text-[12px] leading-relaxed text-slate-600">
                {activeCitation.snippet}
              </p>
              <div className="mt-3">
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-1 rounded-full bg-accent-500"
                    style={{ width: `${Math.round(activeCitation.relevance * 100)}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[9.5px] text-slate-400">
                  relevance {(activeCitation.relevance * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-500">How this works</p>
            <ol className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">1. Retrieve.</span> Your question is matched against the
                corpus with a hybrid BM25 + tag scorer.
              </li>
              <li>
                <span className="font-semibold text-slate-800">2. Ground.</span> Only the top chunks are passed forward —
                the model may not answer from outside them.
              </li>
              <li>
                <span className="font-semibold text-slate-800">3. Cite.</span> Each claim links to a document id you can
                inspect.
              </li>
            </ol>
            <p className="mt-3 border-t border-slate-100 pt-2.5 text-[10px] leading-relaxed text-slate-400">
              Out-of-scope questions return an explicit “no match” rather than a plausible guess.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Bubble({ message, onCite, onFollowUp, simple = false }) {
  const isUser = message.role === 'user';

  const body = typeof message.content === 'string' ? message.content : '';

  if (isUser) {
    return (
      <div className="flex justify-end gap-2.5">
        <div
          className={`max-w-[85%] bg-accent-600 px-4 py-2.5 leading-relaxed text-white ${
            simple
              ? 'rounded-2xl rounded-tr-md text-[14px] shadow-sm'
              : 'rounded-2xl rounded-tr-sm text-[13px]'
          }`}
        >
          {body}
        </div>
        {simple ? null : (
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600">
            <User size={14} />
          </span>
        )}
      </div>
    );
  }

  if (simple) {
    const simplified = simpleChatAnswer(body);
    return (
      <div className="flex gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
          <Bot size={14} />
        </span>
        <div className="min-w-0 max-w-[88%] flex-1">
          <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-soft">
            <div className="space-y-2 text-[14px] leading-relaxed text-slate-700">
              {simplified.split('\n').filter(Boolean).map((line, i) => (
                <Paragraph key={i} line={line} simple />
              ))}
            </div>

            {message.low_confidence ? (
              <p className="mt-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-800">
                I am not fully sure about this one — please check with your engineer or the latest code.
              </p>
            ) : null}

            {message.citations?.length ? (
              <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Library size={11} />
                Checked against {message.citations.length} reference
                {message.citations.length === 1 ? '' : 's'}
                <ExpertOnlyInline />
              </p>
            ) : null}

            {message.follow_ups?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.follow_ups.slice(0, 2).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onFollowUp(f)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-accent-300 hover:text-accent-700"
                  >
                    {f}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
        <Bot size={14} />
      </span>
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3">
          <div className="space-y-2 text-[13px] leading-relaxed text-slate-700">
            {body.split('\n').filter(Boolean).map((line, i) => (
              <Paragraph key={i} line={line} />
            ))}
          </div>

          {message.low_confidence ? (
            <p className="mt-2.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
              Low retrieval confidence — verify this against the current edition of the standard.
            </p>
          ) : null}

          {message.citations?.length ? (
            <div className="mt-3 border-t border-slate-100 pt-2.5">
              <p className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-slate-400">
                Sources
              </p>
              <div className="flex flex-wrap gap-1.5">
                {message.citations.map((c) => (
                  <button
                    key={c.doc_id}
                    type="button"
                    onClick={() => onCite(c)}
                    className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left transition hover:border-accent-300 hover:bg-accent-50"
                  >
                    <span className="font-mono text-[9.5px] font-semibold text-accent-700">{c.doc_id}</span>
                    <span className="truncate text-[10.5px] text-slate-600">{c.standard_code}</span>
                    <span className="shrink-0 rounded bg-white px-1 font-mono text-[9px] text-slate-400 ring-1 ring-slate-200">
                      {Math.round(c.relevance * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {message.follow_ups?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.follow_ups.slice(0, 3).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onFollowUp(f)}
                  className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[10.5px] text-slate-500 transition hover:border-accent-400 hover:text-accent-700"
                >
                  {f}
                </button>
              ))}
            </div>
          ) : null}

          {message.engine ? <EngineFooter engine={message.engine} /> : null}
        </div>
      </div>
    </div>
  );
}

/** Points to Expert View for the citation trail without adding noise to the answer. */
function ExpertOnlyInline() {
  const { setMode } = useViewMode();
  return (
    <button
      type="button"
      onClick={() => setMode('expert')}
      className="ml-auto text-[10.5px] font-medium text-accent-600 hover:text-accent-700"
    >
      See sources
    </button>
  );
}

/** Renders **bold** inline segments and `code` spans without a markdown dependency. */
function Paragraph({ line, simple = false }) {
  const trimmed = line.replace(/^[-•]\s+/, '');
  const isBullet = /^[-•]\s+/.test(line);

  const parts = trimmed
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[KB-\d+\])/g)
    .filter(Boolean);

  const content = parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={i} className="italic text-slate-800">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11.5px] text-slate-700">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^\[KB-\d+\]$/.test(part)) {
      // Raw document ids are an expert affordance; in Simple View the sentence reads
      // the same without them, so drop the token entirely.
      if (simple) return null;
      return (
        <span
          key={i}
          className="mx-0.5 rounded bg-accent-50 px-1 font-mono text-[10px] font-semibold text-accent-700 ring-1 ring-inset ring-accent-200"
        >
          {part.slice(1, -1)}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });

  if (isBullet) {
    return (
      <p className="flex gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
        <span>{content}</span>
      </p>
    );
  }
  return <p>{content}</p>;
}
