/***
 * FedEx Sort Maintenance — Clean Professional
 * Style : blanc · violet FedEx · orange accent
 * Pages : Accueil → Rapport
 * Extras : Photos · Commentaires · KPI · Timeline · PDF
 *
 * npm install dompurify html2pdf.js
 * npm install --save-dev @types/dompurify @types/html2pdf.js
 * .env → VITE_API_URL=http://localhost:3000
 */

import {
  useState, useCallback, useMemo, useRef,
  useEffect, type ReactNode, type DragEvent,
} from 'react';
import DOMPurify from 'dompurify';

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface Downtime { downtime?: number | string; }

interface WorkOrder {
  wonum?: string;
  status?: string;
  failurecode?: string;
  actstart?: string;
  actfinish?: string;
  reportdate?: string;
  description?: string;
  location?: { location?: string };
  asset?: { assettag?: string };
  moddowntimehist?: Downtime[];
  incidentType?: string;
  incidentTimeline?: string;
  fiveWhy?: string;
  rootCause?: string;
  impactOPS?: string;
}

type FetchStatus = 'idle' | 'loading' | 'success' | 'notfound' | 'error';
interface WOState { status: FetchStatus; data: WorkOrder | null; error: string | null; }
interface HistoryEntry { wonum: string; description?: string; fetchedAt: string; }

interface TimelineEvent {
  time: string;
  label: string;
  type: 'detect' | 'arrival' | 'repair' | 'test' | 'close' | 'info';
}

interface Comment {
  id: string;
  author: string;
  role: 'Technicien' | 'OPS Manager' | 'Superviseur' | 'Autre';
  text: string;
  createdAt: string;
}

interface Photo {
  id: string;
  dataUrl: string;
  name: string;
  addedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function fmtDate(v?: string): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return v; }
}

function fmtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDuration(start?: string, end?: string): string {
  if (!start || !end) return '—';
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 0) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m.toString().padStart(2,'0')}min` : `${m} min`;
  } catch { return '—'; }
}

function safeHtml(html?: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','br','ul','ol','li','strong','em','span','b','i'],
    ALLOWED_ATTR: [],
  });
}

const WO_REGEX = /^[A-Z0-9\-]{2,20}$/;
function validateWoNum(raw: string): string | null {
  const wo = raw.trim().toUpperCase();
  if (!wo) return 'Numéro requis';
  if (!WO_REGEX.test(wo)) return 'Format invalide — ex: WO2907320';
  return null;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  COMP:       { label: 'Complété',    color: '#15803d', bg: '#dcfce7' },
  'RCA-COMP': { label: 'RCA Comp',   color: '#15803d', bg: '#dcfce7' },
  WAPPR:      { label: 'En attente', color: '#b45309', bg: '#fef3c7' },
  APPR:       { label: 'Approuvé',  color: '#1d4ed8', bg: '#dbeafe' },
  WMATL:      { label: 'Matériaux', color: '#7e22ce', bg: '#f3e8ff' },
  INPRG:      { label: 'En cours',  color: '#c2410c', bg: '#ffedd5' },
  CAN:        { label: 'Annulé',    color: '#374151', bg: '#f3f4f6' },
};
function getStatus(s?: string) {
  return STATUS_MAP[s ?? ''] ?? { label: s ?? '—', color: '#374151', bg: '#f3f4f6' };
}

function parseTimeline(html?: string): TimelineEvent[] {
  if (!html) return [];
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const events: TimelineEvent[] = [];
  for (const sentence of plain.split(/[.;]/)) {
    const match = sentence.match(/[ÀA]\s*(\d{1,2}h\d{0,2}|\d{1,2}:\d{2})/i);
    if (!match) continue;
    const time = match[1].replace(':', 'h');
    const text = sentence.replace(match[0], '').trim().replace(/^[,\s–-]+/, '');
    if (!text || text.length < 5) continue;
    const lower = text.toLowerCase();
    let type: TimelineEvent['type'] = 'info';
    if (/détect|signal|alarm|missing|panne|arrêt|bloqué/.test(lower))    type = 'detect';
    else if (/interven|technic|équipe|arrivée|début|constat/.test(lower)) type = 'arrival';
    else if (/réparat|remplac|fix|chang|retrait|install/.test(lower))     type = 'repair';
    else if (/test|essai|véri|relancé|redémarr/.test(lower))             type = 'test';
    else if (/clotur|terminé|complet|remis|fin|clos/.test(lower))        type = 'close';
    events.push({ time, label: text.length > 130 ? text.slice(0,130)+'…' : text, type });
  }
  return events;
}

function loadLS<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
function saveLS<T>(key: string, v: T): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /**/ }
}

// ─────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────

function useWorkOrder() {
  const [state, setState] = useState<WOState>({ status: 'idle', data: null, error: null });

  const fetch_ = useCallback(async (raw: string): Promise<WorkOrder | null> => {
    const err = validateWoNum(raw);
    if (err) { setState({ status: 'error', data: null, error: err }); return null; }
    const wonum = raw.trim().toUpperCase();
    setState({ status: 'loading', data: null, error: null });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${API_BASE}/api/wo/${wonum}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        let msg = `Erreur HTTP ${res.status}`;
        try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /**/ }
        setState({ status: 'error', data: null, error: msg }); return null;
      }
      const json = await res.json();
      if (json.notFound) { setState({ status: 'notfound', data: null, error: null }); return null; }
      setState({ status: 'success', data: json as WorkOrder, error: null });
      return json as WorkOrder;
    } catch (e: unknown) {
      clearTimeout(timer);
      let msg = 'Erreur réseau.';
      if (e instanceof DOMException && e.name === 'AbortError') msg = 'Timeout (15s).';
      else if (e instanceof Error) msg = e.message;
      setState({ status: 'error', data: null, error: msg }); return null;
    }
  }, []);

  const downtimeTotal = useMemo(() => {
    if (!state.data?.moddowntimehist) return 0;
    return state.data.moddowntimehist.reduce((s, d) => s + Number(d.downtime ?? 0), 0);
  }, [state.data]);

  return { ...state, isLoading: state.status === 'loading', isSuccess: state.status === 'success', downtimeTotal, fetch: fetch_ } as const;
}

const HIST_KEY = 'wo_history_cp';
function useHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadLS<HistoryEntry[]>(HIST_KEY) ?? []);
  const push = useCallback((wo: WorkOrder) => {
    if (!wo.wonum) return;
    setHistory(prev => {
      const next = [
        { wonum: wo.wonum!, description: wo.description, fetchedAt: new Date().toISOString() },
        ...prev.filter(e => e.wonum !== wo.wonum),
      ].slice(0, 10);
      saveLS(HIST_KEY, next);
      return next;
    });
  }, []);
  const clear = useCallback(() => { setHistory([]); localStorage.removeItem(HIST_KEY); }, []);
  return { history, push, clear } as const;
}

function usePhotos(wonum?: string) {
  const key = wonum ? `wo_photos_${wonum}` : null;
  const [photos, setPhotos] = useState<Photo[]>([]);
  useEffect(() => { if (key) setPhotos(loadLS<Photo[]>(key) ?? []); }, [key]);

  const addPhotos = useCallback((files: FileList | File[]) => {
    if (!key) return;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target?.result as string;
        setPhotos(prev => {
          const next = [...prev, { id: crypto.randomUUID(), dataUrl, name: file.name, addedAt: new Date().toISOString() }];
          saveLS(key, next); return next;
        });
      };
      reader.readAsDataURL(file);
    });
  }, [key]);

  const removePhoto = useCallback((id: string) => {
    if (!key) return;
    setPhotos(prev => { const next = prev.filter(p => p.id !== id); saveLS(key, next); return next; });
  }, [key]);

  return { photos, addPhotos, removePhoto } as const;
}

function useComments(wonum?: string) {
  const key = wonum ? `wo_comments_${wonum}` : null;
  const [comments, setComments] = useState<Comment[]>([]);
  useEffect(() => { if (key) setComments(loadLS<Comment[]>(key) ?? []); }, [key]);

  const addComment = useCallback((author: string, role: Comment['role'], text: string) => {
    if (!key || !text.trim()) return;
    setComments(prev => {
      const next = [...prev, { id: crypto.randomUUID(), author: author.trim() || 'Anonyme', role, text: text.trim(), createdAt: new Date().toISOString() }];
      saveLS(key, next); return next;
    });
  }, [key]);

  const removeComment = useCallback((id: string) => {
    if (!key) return;
    setComments(prev => { const next = prev.filter(c => c.id !== id); saveLS(key, next); return next; });
  }, [key]);

  return { comments, addComment, removeComment } as const;
}

// ─────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────

async function exportToPdf(wonum?: string) {
  const html2pdf = (await import('html2pdf.js')).default;
  const el = document.getElementById('wo-report');
  if (!el) return;
  const hidden = el.querySelectorAll<HTMLElement>('.no-print');
  hidden.forEach(e => { e.dataset.pd = e.style.display; e.style.display = 'none'; });
  await (html2pdf() as any).set({
    margin: [14, 12, 14, 12],
    filename: `WO_${wonum ?? 'rapport'}_incident.pdf`,
    image: { type: 'jpeg', quality: 0.97 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  }).from(el).save();
  hidden.forEach(e => { e.style.display = e.dataset.pd ?? ''; });
}

// ─────────────────────────────────────────────────────────────────
// PAGE ACCUEIL
// ─────────────────────────────────────────────────────────────────

function HomePage({ onSearch, isLoading, error, history, onHistorySelect, onHistoryClear }: {
  onSearch: (w: string) => void;
  isLoading: boolean;
  error: string | null;
  history: HistoryEntry[];
  onHistorySelect: (w: string) => void;
  onHistoryClear: () => void;
}) {
  const [value, setValue] = useState('');
  const [valErr, setValErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const err = validateWoNum(value);
    if (err) { setValErr(err); return; }
    setValErr(null);
    onSearch(value.trim().toUpperCase());
  };

  return (
    <div className="home-root">
      {/* Top navigation bar */}
      <nav className="home-nav">
        <div className="home-nav-brand">
          <div className="home-nav-logo">◈</div>
          <span className="home-nav-name">FedEx Sort Maintenance</span>
        </div>
        <span className="home-nav-env">Environnement Production</span>
      </nav>

      <div className="home-content">
        {/* Left — illustration side */}
        <div className="home-left">
          <div className="home-left-inner">
            <div className="home-eyebrow">Système de rapport</div>
            <h1 className="home-title">
              Rapport d'Incident<br />
              <span className="home-title-accent">Maintenance MHE</span>
            </h1>
            <p className="home-desc">
              Consultez, analysez et documentez vos Work Orders Maximo.
              Ajoutez des photos, des commentaires terrain et exportez en PDF.
            </p>

            {/* Feature pills */}
            <div className="home-features">
              {['Timeline visuelle', 'Photos & commentaires', 'Export PDF', 'Historique local'].map(f => (
                <span key={f} className="home-feature-pill">{f}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Right — search card */}
        <div className="home-right">
          <div className="home-card">
            <div className="home-card-header">
              <h2 className="home-card-title">Accéder à un WO</h2>
              <p className="home-card-sub">Saisissez le numéro Maximo</p>
            </div>

            <div className="home-field-wrap">
              <label className="home-label" htmlFor="wo-input">Numéro de Work Order</label>
              <div className={`home-input-row${valErr || error ? ' has-error' : ''}`}>
                <input
                  id="wo-input"
                  ref={inputRef}
                  className="home-input"
                  placeholder="ex : WO2907320"
                  value={value}
                  onChange={e => { setValue(e.target.value); setValErr(null); }}
                  onKeyDown={e => e.key === 'Enter' && !isLoading && submit()}
                  disabled={isLoading}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              {(valErr || error) && (
                <p className="home-field-error">{valErr ?? error}</p>
              )}
            </div>

            <button className="home-btn" onClick={submit} disabled={isLoading}>
              {isLoading
                ? <><span className="home-spinner" /> Chargement…</>
                : 'Charger le Work Order →'
              }
            </button>

            {/* History */}
            {history.length > 0 && (
              <div className="home-hist">
                <div className="home-hist-head">
                  <span className="home-hist-label">Consultés récemment</span>
                  <button className="home-hist-clear" onClick={onHistoryClear}>Effacer</button>
                </div>
                <div className="home-hist-list">
                  {history.slice(0, 6).map(e => (
                    <button key={e.wonum} className="home-hist-item" onClick={() => onHistorySelect(e.wonum)}>
                      <span className="home-hist-wo">{e.wonum}</span>
                      {e.description && (
                        <span className="home-hist-desc">
                          {e.description.length > 32 ? e.description.slice(0,32)+'…' : e.description}
                        </span>
                      )}
                      <span className="home-hist-arrow">→</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="home-legal">CDG · FedEx Express Europe · MHE Maintenance System</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// REPORT COMPONENTS
// ─────────────────────────────────────────────────────────────────

function TopBar({ wonum, onBack, onExport }: { wonum?: string; onBack: () => void; onExport: () => void }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">◈</div>
        <span className="topbar-brand">FedEx Sort Maintenance</span>
      </div>
      <div className="topbar-center">
        <span className="topbar-wo-label">Work Order</span>
        <span className="topbar-wo">{wonum}</span>
      </div>
      <div className="topbar-right">
        <button className="topbar-back no-print" onClick={onBack}>← Accueil</button>
        <button className="topbar-export no-print" onClick={onExport}>↓ Export PDF</button>
      </div>
    </div>
  );
}

/* ── KPI Cards ── */
function KpiCards({ wo, dt }: { wo: WorkOrder; dt: number }) {
  const critical = dt >= 4;
  const { label, color, bg } = getStatus(wo.status);
  const cards = [
    { label: 'Downtime total', value: `${dt.toFixed(2)} h`, sub: critical ? '⚠ Seuil critique' : '✓ Dans les normes', color: critical ? '#dc2626' : '#16a34a', bg: critical ? '#fef2f2' : '#f0fdf4', icon: '⏱' },
    { label: 'Statut WO',      value: label,                sub: wo.wonum ?? '—',                                      color, bg, icon: '📋' },
    { label: 'Durée',          value: fmtDuration(wo.actstart, wo.actfinish), sub: wo.actstart ? fmtDate(wo.actstart).split(' ')[0] : '—', color: '#4d148c', bg: '#f5f3ff', icon: '🕐' },
    { label: 'Équipement',     value: wo.asset?.assettag ?? '—', sub: wo.location?.location ?? '—',                    color: '#1d4ed8', bg: '#eff6ff', icon: '⚙️' },
  ];
  return (
    <div className="kpi-row">
      {cards.map((c, i) => (
        <div key={i} className="kpi" style={{ '--kpi-bg': c.bg, '--kpi-color': c.color } as React.CSSProperties}>
          <div className="kpi-icon">{c.icon}</div>
          <div className="kpi-body">
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-value">{c.value}</div>
            <div className="kpi-sub">{c.sub}</div>
          </div>
          <div className="kpi-accent" />
        </div>
      ))}
    </div>
  );
}

/* ── Card wrapper ── */
function Card({ title, icon, children, id, className = '' }: {
  title: string; icon?: string; children: ReactNode; id?: string; className?: string;
}) {
  return (
    <div className={`card ${className}`} id={id}>
      <div className="card-head">
        {icon && <span className="card-icon">{icon}</span>}
        <h2 className="card-title">{title}</h2>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

/* ── Field row ── */
function Field({ label, value, mono = false, copy }: {
  label: string; value?: ReactNode; mono?: boolean; copy?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!copy) return;
    try { await navigator.clipboard.writeText(copy); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /**/ }
  };
  return (
    <div className="field-row">
      <span className="field-lbl">{label}</span>
      <span className={`field-val${mono ? ' field-mono' : ''}`}>
        {value ?? '—'}
        {copy && (
          <button className="copy-btn no-print" onClick={handleCopy} title={copied ? 'Copié !' : 'Copier'}>
            {copied ? '✓' : '⧉'}
          </button>
        )}
      </span>
    </div>
  );
}

/* ── Status badge ── */
function StatusBadge({ status }: { status?: string }) {
  const { label, color, bg } = getStatus(status);
  return (
    <span className="status-badge" style={{ color, background: bg, borderColor: color + '40' }}>{label}</span>
  );
}

/* ── Downtime bar ── */
function DowntimeBar({ hours }: { hours: number }) {
  const pct = (Math.min(hours, 12) / 12) * 100;
  const critical = hours >= 4;
  return (
    <div className="dt-wrap">
      <div className="dt-track">
        <div className="dt-fill" style={{ width: `${pct}%`, background: critical ? '#dc2626' : '#16a34a' }} />
      </div>
      <span className="dt-label" style={{ color: critical ? '#dc2626' : '#16a34a' }}>
        {hours.toFixed(2)} h{critical ? ' ⚠' : ''}
      </span>
    </div>
  );
}

/* ── Timeline ── */
const TL_ICONS: Record<TimelineEvent['type'], string> = {
  detect:'🔴', arrival:'👷', repair:'🔧', test:'✅', close:'🔒', info:'📌',
};
const TL_COLORS: Record<TimelineEvent['type'], string> = {
  detect:'#dc2626', arrival:'#2563eb', repair:'#d97706', test:'#16a34a', close:'#7e22ce', info:'#6b7280',
};

function VisualTimeline({ html }: { html?: string }) {
  const events = parseTimeline(html);
  if (events.length === 0)
    return <div className="rich-text" dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />;
  return (
    <div className="timeline">
      {events.map((ev, i) => (
        <div key={i} className="tl-item">
          <div className="tl-left">
            <div className="tl-dot" style={{ borderColor: TL_COLORS[ev.type], background: TL_COLORS[ev.type]+'12' }}>
              {TL_ICONS[ev.type]}
            </div>
            {i < events.length - 1 && <div className="tl-line" />}
          </div>
          <div className="tl-right">
            <span className="tl-time" style={{ color: TL_COLORS[ev.type], background: TL_COLORS[ev.type]+'10', borderColor: TL_COLORS[ev.type]+'30' }}>
              {ev.time}
            </span>
            <p className="tl-label">{ev.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Diag step ── */
function DiagStep({ n, title, content, richText=false, timeline=false }: {
  n: number; title: string; content?: string; richText?: boolean; timeline?: boolean;
}) {
  return (
    <div className="diag-step">
      <div className="diag-head">
        <span className="diag-num">{n}</span>
        <h3 className="diag-title">{title}</h3>
      </div>
      <div className="diag-body">
        {!content
          ? <span className="diag-empty">Non renseigné</span>
          : timeline ? <VisualTimeline html={content} />
          : richText ? <div className="rich-text" dangerouslySetInnerHTML={{ __html: safeHtml(content) }} />
          : <p className="diag-text">{content}</p>
        }
      </div>
    </div>
  );
}

/* ── Photos ── */
function PhotoSection({ wonum }: { wonum?: string }) {
  const { photos, addPhotos, removePhoto } = usePhotos(wonum);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) addPhotos(e.dataTransfer.files);
  };

  return (
    <Card title="Photos de l'incident" icon="📷" id="section-photos">
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only"
          onChange={e => e.target.files && addPhotos(e.target.files)} />
        <div className="dropzone-icon">📎</div>
        <div className="dropzone-text">
          {dragging ? 'Relâchez pour ajouter' : 'Glisser des photos ici'}
        </div>
        <div className="dropzone-sub">ou <span className="dropzone-link">cliquer pour parcourir</span> · JPG, PNG, WEBP</div>
      </div>

      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map(p => (
            <div key={p.id} className="photo-thumb">
              <img src={p.dataUrl} alt={p.name} className="photo-img" onClick={() => setLightbox(p.dataUrl)} />
              <button className="photo-del no-print" onClick={e => { e.stopPropagation(); removePhoto(p.id); }}>✕</button>
              <div className="photo-name">{p.name.length > 16 ? p.name.slice(0,16)+'…' : p.name}</div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button className="lightbox-close no-print" onClick={() => setLightbox(null)}>✕</button>
          <img src={lightbox} alt="Aperçu" className="lightbox-img" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </Card>
  );
}

/* ── Comments ── */
const ROLE_CFG: Record<Comment['role'], { color: string; bg: string }> = {
  'Technicien':  { color: '#4d148c', bg: '#f5f3ff' },
  'OPS Manager': { color: '#c2410c', bg: '#fff7ed' },
  'Superviseur': { color: '#15803d', bg: '#f0fdf4' },
  'Autre':       { color: '#374151', bg: '#f9fafb' },
};

function CommentSection({ wonum }: { wonum?: string }) {
  const { comments, addComment, removeComment } = useComments(wonum);
  const [author, setAuthor] = useState('');
  const [role, setRole] = useState<Comment['role']>('Technicien');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (!text.trim()) return;
    setSending(true);
    setTimeout(() => { addComment(author, role, text); setText(''); setSending(false); }, 250);
  };

  return (
    <Card title="Commentaires & Notes terrain" icon="💬" id="section-comments">
      {comments.length === 0
        ? <p className="comments-empty">Aucun commentaire pour ce Work Order.</p>
        : (
          <div className="comments-list">
            {comments.map(c => {
              const cfg = ROLE_CFG[c.role];
              return (
                <div key={c.id} className="comment">
                  <div className="comment-head">
                    <div className="comment-avatar" style={{ color: cfg.color, background: cfg.bg }}>
                      {c.author.slice(0,2).toUpperCase()}
                    </div>
                    <div className="comment-meta">
                      <span className="comment-author">{c.author}</span>
                      <span className="comment-role" style={{ color: cfg.color, background: cfg.bg }}>{c.role}</span>
                    </div>
                    <span className="comment-date">{fmtShort(c.createdAt)}</span>
                    <button className="comment-del no-print" onClick={() => removeComment(c.id)}>✕</button>
                  </div>
                  <p className="comment-text">{c.text}</p>
                </div>
              );
            })}
          </div>
        )
      }

      <div className="comment-form no-print">
        <div className="cf-row">
          <input className="cf-input" placeholder="Votre nom" value={author} onChange={e => setAuthor(e.target.value)} maxLength={40} />
          <select className="cf-select" value={role} onChange={e => setRole(e.target.value as Comment['role'])}>
            <option>Technicien</option>
            <option>OPS Manager</option>
            <option>Superviseur</option>
            <option>Autre</option>
          </select>
        </div>
        <textarea
          className="cf-textarea"
          placeholder="Ajouter une observation, une action corrective, une note terrain…"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          maxLength={1000}
        />
        <div className="cf-foot">
          <span className="cf-char">{text.length}/1000</span>
          <button className="cf-send" onClick={handleSend} disabled={!text.trim() || sending}>
            {sending ? '…' : '+ Ajouter le commentaire'}
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ── Skeleton ── */
function SkLine({ w='100%' }: { w?: string }) {
  return <div className="sk-line" style={{ width: w }} />;
}
function SkeletonReport() {
  return (
    <div className="sk-wrap" role="status" aria-label="Chargement…">
      <div className="kpi-row">
        {[0,1,2,3].map(i => <div key={i} className="kpi"><div style={{flex:1}}><SkLine w="55%"/><SkLine w="35%"/></div></div>)}
      </div>
      <div className="info-grid">
        {[0,1].map(i => <div key={i} className="card"><div className="card-body" style={{display:'flex',flexDirection:'column',gap:10}}>{[80,65,75,55,70].map((w,j)=><SkLine key={j} w={`${w}%`}/>)}</div></div>)}
      </div>
      <div className="card"><div className="card-body" style={{display:'flex',flexDirection:'column',gap:10}}>{[90,70,80,60,75].map((w,i)=><SkLine key={i} w={`${w}%`}/>)}</div></div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────

export default function App() {
  const wo = useWorkOrder();
  const hist = useHistory();
  const [page, setPage] = useState<'home' | 'report'>('home');

  const handleSearch = useCallback(async (wonum: string) => {
    const result = await wo.fetch(wonum);
    if (result) { hist.push(result); setPage('report'); }
  }, [wo, hist]);

  return (
    <>
      {/* ── Accueil ── */}
      {page === 'home' && (
        <HomePage
          onSearch={handleSearch}
          isLoading={wo.isLoading}
          error={wo.status === 'notfound' ? 'Aucun Work Order trouvé.' : wo.error}
          history={hist.history}
          onHistorySelect={handleSearch}
          onHistoryClear={hist.clear}
        />
      )}

      {/* ── Rapport loading ── */}
      {page === 'report' && wo.isLoading && (
        <div className="report-root">
          <TopBar onBack={() => setPage('home')} onExport={() => {}} />
          <div className="report-body"><SkeletonReport /></div>
        </div>
      )}

      {/* ── Rapport ── */}
      {page === 'report' && wo.isSuccess && wo.data && (
        <div className="report-root">
          <TopBar wonum={wo.data.wonum} onBack={() => setPage('home')} onExport={() => exportToPdf(wo.data?.wonum)} />
          <div className="report-body" id="wo-report">

            <KpiCards wo={wo.data} dt={wo.downtimeTotal} />

            <div className="info-grid">
              <Card title="Informations de Base" icon="📄" id="card-base">
                <Field label="Date début"    value={fmtDate(wo.data.actstart)}   copy={wo.data.actstart} />
                <Field label="Date fin"      value={fmtDate(wo.data.actfinish)}  copy={wo.data.actfinish} />
                <Field label="Date création" value={fmtDate(wo.data.reportdate)} />
                <Field label="Emplacement"   value={wo.data.location?.location}  copy={wo.data.location?.location} />
                <Field label="Équipement"    value={wo.data.asset?.assettag}     copy={wo.data.asset?.assettag} mono />
                <Field label="Description"   value={wo.data.description}         copy={wo.data.description} />
              </Card>

              <Card title="Intervention" icon="🔧" id="card-intervention">
                <Field label="N° WO"         value={<strong style={{color:'#4d148c'}}>{wo.data.wonum}</strong>} copy={wo.data.wonum} />
                <Field label="Statut"         value={<StatusBadge status={wo.data.status} />} />
                <Field label="Failure Code"   value={wo.data.failurecode}   copy={wo.data.failurecode} mono />
                <Field label="Downtime total" value={<DowntimeBar hours={wo.downtimeTotal} />} />
                <Field label="Impact OPS"     value={wo.data.impactOPS}     copy={wo.data.impactOPS} />
              </Card>
            </div>

            <Card title="Étapes du Diagnostic — RCA" icon="🔍" id="card-rca">
              <DiagStep n={1} title="Type d'Incident"           content={wo.data.incidentType} />
              <DiagStep n={2} title="Chronologie de l'Incident" content={wo.data.incidentTimeline} timeline />
              <DiagStep n={3} title="Analyse 5 Pourquoi"        content={wo.data.fiveWhy}          richText />
              <DiagStep n={4} title="Cause Racine"              content={wo.data.rootCause}        richText />
            </Card>

            <PhotoSection wonum={wo.data.wonum} />
            <CommentSection wonum={wo.data.wonum} />
          </div>
        </div>
      )}
    </>
  );
}
