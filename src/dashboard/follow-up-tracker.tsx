import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CircleCheck, Clock3, ExternalLink, Pencil, Plus, RefreshCw, Search, Trash2, Undo2 } from 'lucide-react';
import {
  createFollowUp,
  deleteFollowUp,
  dueGroupFor,
  EMPTY_FOLLOW_UP_INPUT,
  filterFollowUps,
  FOLLOW_UP_CATEGORIES,
  followUpSummary,
  listFollowUps,
  localDateKey,
  setFollowUpStatus,
  sortFollowUps,
  validateFollowUpInput,
  updateFollowUp,
  type DueGroup,
  type FollowUp,
  type FollowUpCategory,
  type FollowUpFieldErrors,
  type FollowUpInput,
  type FollowUpPriority,
  type FollowUpSort,
  type FollowUpStatus,
} from './follow-up-store';
import './follow-up-tracker.css';

type StatusFilter = FollowUpStatus | 'all';
type CategoryFilter = FollowUpCategory | 'all';
type PriorityFilter = FollowUpPriority | 'all';
type DueFilter = DueGroup | 'all';

const categoryLabels: Record<FollowUpCategory, string> = {
  subscription: 'Subscription', trial: 'Trial', task: 'Task', renewal: 'Renewal', other: 'Other',
};
const priorityLabels: Record<FollowUpPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const dueLabels: Record<DueGroup, string> = {
  overdue: 'Overdue', 'due-soon': 'Due soon', upcoming: 'Upcoming', 'no-date': 'No due date', completed: 'Completed',
};

function localDateLabel(value: string): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function websiteLabel(value: string): string {
  try { return new URL(value).host; } catch { return value; }
}

export function FollowUpTracker() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUp>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [dueGroup, setDueGroup] = useState<DueFilter>('all');
  const [sort, setSort] = useState<FollowUpSort>('due-date');

  const refresh = async () => {
    setLoading(true);
    setError('');
    setLoadFailed(false);
    try { setItems(await listFollowUps()); }
    catch (cause) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : 'Follow-ups could not be loaded from local storage.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const today = localDateKey();
  const summary = followUpSummary(items, today);
  const visibleItems = sortFollowUps(filterFollowUps(items, {
    query, status, category, priority, dueGroup, today,
  }), sort);

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(item: FollowUp) {
    setEditing(item);
    setFormOpen(true);
  }

  async function save(input: FollowUpInput) {
    setError('');
    const next = editing ? await updateFollowUp(editing.id, input) : await createFollowUp(input);
    setItems(next);
    setNotice(editing ? 'Follow-up updated.' : 'Follow-up added.');
    setFormOpen(false);
    setEditing(undefined);
  }

  async function toggleStatus(item: FollowUp) {
    const nextStatus: FollowUpStatus = item.status === 'pending' ? 'completed' : 'pending';
    setBusyId(item.id);
    setError('');
    try {
      setItems(await setFollowUpStatus(item.id, nextStatus));
      setNotice(nextStatus === 'completed' ? 'Follow-up marked complete.' : 'Follow-up reopened.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyId(undefined); }
  }

  async function remove(item: FollowUp) {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    setBusyId(item.id);
    setError('');
    try {
      setItems(await deleteFollowUp(item.id));
      setNotice('Follow-up deleted.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyId(undefined); }
  }

  return <section className="followup-tracker" aria-label="Follow-up Tracker">
    <div className="followup-toolbar">
      <p>Manually track renewals, tasks, and other dates. These records stay in this browser profile.</p>
      <div className="followup-toolbar-actions">
        <button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} aria-hidden="true"/> Refresh</button>
        <button className="primary-button" onClick={openCreate}><Plus size={16} aria-hidden="true"/> Add follow-up</button>
      </div>
    </div>

    {error && <div className="followup-error" role="alert">{error}</div>}
    {notice && <p className="followup-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></p>}

    <div className="followup-summary" aria-label="Follow-up summary">
      <SummaryCard label="Active" count={summary.active} icon={Clock3} tone="neutral" />
      <SummaryCard label="Overdue" count={summary.overdue} icon={Clock3} tone="danger" />
      <SummaryCard label="Due soon" count={summary.dueSoon} icon={Clock3} tone="warning" />
      <SummaryCard label="Completed" count={summary.completed} icon={CircleCheck} tone="success" />
    </div>

    <div className="followup-controls" aria-label="Filter and sort follow-ups">
      <label className="followup-search"><Search size={16} aria-hidden="true"/><span className="sr-only">Search title or description</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search follow-ups" /></label>
      <SelectFilter label="Status" value={status} onChange={(value) => setStatus(value as StatusFilter)} options={[
        ['all', 'All status'], ['pending', 'Active'], ['completed', 'Completed'],
      ]}/>
      <SelectFilter label="Category" value={category} onChange={(value) => setCategory(value as CategoryFilter)} options={[
        ['all', 'All categories'], ...FOLLOW_UP_CATEGORIES.map((value) => [value, categoryLabels[value]] as [string, string]),
      ]}/>
      <SelectFilter label="Priority" value={priority} onChange={(value) => setPriority(value as PriorityFilter)} options={[
        ['all', 'All priorities'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'],
      ]}/>
      <SelectFilter label="Due date" value={dueGroup} onChange={(value) => setDueGroup(value as DueFilter)} options={[
        ['all', 'All due dates'], ['overdue', 'Overdue'], ['due-soon', 'Due soon'], ['upcoming', 'Upcoming'], ['no-date', 'No due date'], ['completed', 'Completed'],
      ]}/>
      <SelectFilter label="Sort" value={sort} onChange={(value) => setSort(value as FollowUpSort)} options={[
        ['due-date', 'Due date'], ['updated', 'Recently updated'], ['priority', 'Priority'], ['title', 'Title'],
      ]}/>
    </div>

    {loading ? <div className="followup-empty">Loading saved follow-ups…</div> : loadFailed ? (
      <div className="followup-empty"><h2>Saved follow-ups could not be loaded</h2><p>BrowserTrust could not read local extension storage. Your saved items have not been changed.</p>
        <button className="secondary-button" onClick={() => void refresh()}>Try again</button></div>
    ) : items.length === 0 ? (
      <div className="followup-empty-state"><Check size={27} aria-hidden="true"/><h2>Your follow-up list is clear</h2>
        <p>Add a renewal, task, trial date, or other deadline when you want to remember it. BrowserTrust will not scan websites or detect these automatically.</p>
        <button className="primary-button" onClick={openCreate}><Plus size={15} aria-hidden="true"/> Add your first follow-up</button></div>
    ) : visibleItems.length === 0 ? (
      <div className="followup-empty"><h2>No matches</h2><p>Try changing the search or filters.</p><button className="secondary-button" onClick={() => { setQuery(''); setStatus('all'); setCategory('all'); setPriority('all'); setDueGroup('all'); }}>Clear filters</button></div>
    ) : (
      <>
        <div className="followup-results"><strong>{visibleItems.length}</strong> {visibleItems.length === 1 ? 'follow-up' : 'follow-ups'}</div>
        <div className="followup-table-wrap"><table className="followup-table"><thead><tr>
          <th scope="col">Follow-up</th><th scope="col">Due</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead><tbody>{visibleItems.map((item) => <FollowUpRow key={item.id} item={item} busy={busyId === item.id}
          onEdit={() => openEdit(item)} onToggle={() => void toggleStatus(item)} onDelete={() => void remove(item)} />)}</tbody></table></div>
      </>
    )}

    {formOpen && <FollowUpDialog key={editing?.id ?? 'new'} initial={editing} onClose={() => { setFormOpen(false); setEditing(undefined); }} onSave={save} />}
  </section>;
}

function SummaryCard({ label, count, icon: Icon, tone }: { label: string; count: number; icon: typeof Clock3; tone: 'neutral' | 'danger' | 'warning' | 'success' }) {
  return <div className={`followup-summary-card tone-${tone}`}><span className="followup-summary-icon"><Icon size={17} aria-hidden="true"/></span><div><span>{label}</span><strong>{count}</strong></div></div>;
}

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <label className="followup-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function FollowUpRow({ item, busy, onEdit, onToggle, onDelete }: { item: FollowUp; busy: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const group = dueGroupFor(item);
  return <tr className={item.status === 'completed' ? 'followup-row-completed' : undefined}>
    <td><div className="followup-title">{item.title}</div>{item.description && <p className="followup-description">{item.description}</p>}
      <div className="followup-row-meta"><span>{categoryLabels[item.category]}</span>{item.websiteUrl && <a href={item.websiteUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open associated website for ${item.title}`}>
        {websiteLabel(item.websiteUrl)} <ExternalLink size={12} aria-hidden="true"/></a>}</div></td>
    <td><span className={`followup-due-label due-${group}`}>{dueLabels[group]}</span>{item.dueDate && <time dateTime={item.dueDate}>{localDateLabel(item.dueDate)}</time>}{item.status === 'completed' && item.completedAt && <small>Completed {new Date(item.completedAt).toLocaleDateString()}</small>}</td>
    <td><span className={`followup-priority priority-${item.priority}`}>{priorityLabels[item.priority]}</span></td>
    <td><span className={`followup-status status-${item.status}`}>{item.status === 'completed' ? 'Completed' : 'Active'}</span></td>
    <td><div className="followup-row-actions"><button className="followup-icon-button" onClick={onToggle} disabled={busy} aria-label={item.status === 'completed' ? `Reopen ${item.title}` : `Complete ${item.title}`} title={item.status === 'completed' ? 'Reopen' : 'Mark complete'}>
      {item.status === 'completed' ? <Undo2 size={16} aria-hidden="true"/> : <Check size={16} aria-hidden="true"/>}</button>
      <button className="followup-icon-button" onClick={onEdit} disabled={busy} aria-label={`Edit ${item.title}`} title="Edit"><Pencil size={15} aria-hidden="true"/></button>
      <button className="followup-icon-button is-danger" onClick={onDelete} disabled={busy} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={15} aria-hidden="true"/></button></div></td>
  </tr>;
}

function FollowUpDialog({ initial, onClose, onSave }: { initial?: FollowUp; onClose: () => void; onSave: (value: FollowUpInput) => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState<FollowUpInput>(() => initial ? {
    title: initial.title, description: initial.description, category: initial.category,
    dueDate: initial.dueDate ?? '', websiteUrl: initial.websiteUrl ?? '', priority: initial.priority,
  } : { ...EMPTY_FOLLOW_UP_INPUT });
  const [errors, setErrors] = useState<FollowUpFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  function setField<K extends keyof FollowUpInput>(field: K, value: FollowUpInput[K]) {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateFollowUpInput(input);
    if (!result.ok) { setErrors(result.errors); return; }
    setSaving(true);
    setFormError('');
    try { await onSave(result.value); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : 'The follow-up could not be saved.'); }
    finally { setSaving(false); }
  }

  return <dialog className="followup-dialog" ref={dialogRef} aria-labelledby="followup-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => void submit(event)} noValidate>
      <header className="followup-dialog-header"><div><p className="eyebrow">FOLLOW-UP TRACKER</p><h2 id="followup-dialog-title">{initial ? 'Edit follow-up' : 'Add follow-up'}</h2></div>
        <button type="button" className="followup-dialog-close" onClick={onClose} aria-label="Close dialog">×</button></header>
      {formError && <div className="followup-error" role="alert">{formError}</div>}
      <label className="followup-field"><span>Title <b aria-hidden="true">*</b></span><input autoFocus maxLength={120} value={input.title} onChange={(event) => setField('title', event.target.value)} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'followup-title-error' : undefined} />
        {errors.title && <small id="followup-title-error" className="followup-field-error">{errors.title}</small>}</label>
      <label className="followup-field"><span>Details <small>Optional</small></span><textarea rows={4} maxLength={2000} value={input.description} onChange={(event) => setField('description', event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'followup-description-error' : undefined} />
        {errors.description && <small id="followup-description-error" className="followup-field-error">{errors.description}</small>}</label>
      <div className="followup-form-grid">
        <label className="followup-field"><span>Category</span><select value={input.category} onChange={(event) => setField('category', event.target.value as FollowUpCategory)}>
          {FOLLOW_UP_CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select>{errors.category && <small className="followup-field-error">{errors.category}</small>}</label>
        <label className="followup-field"><span>Priority</span><select value={input.priority} onChange={(event) => setField('priority', event.target.value as FollowUpPriority)}>
          {(['low', 'medium', 'high'] as const).map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select>{errors.priority && <small className="followup-field-error">{errors.priority}</small>}</label>
      </div>
      <label className="followup-field"><span>Due date <small>Optional</small></span><input type="date" value={input.dueDate} onChange={(event) => setField('dueDate', event.target.value)} aria-invalid={Boolean(errors.dueDate)} aria-describedby={errors.dueDate ? 'followup-date-error' : undefined} />
        {errors.dueDate && <small id="followup-date-error" className="followup-field-error">{errors.dueDate}</small>}</label>
      <label className="followup-field"><span>Associated website <small>Optional</small></span><input type="url" inputMode="url" maxLength={2048} placeholder="https://example.com" value={input.websiteUrl} onChange={(event) => setField('websiteUrl', event.target.value)} aria-invalid={Boolean(errors.websiteUrl)} aria-describedby="followup-website-help" />
        <small id="followup-website-help" className={errors.websiteUrl ? 'followup-field-error' : 'followup-hint'}>{errors.websiteUrl ?? 'Only the HTTP(S) address and path are kept; query and fragment are removed.'}</small></label>
      <footer className="followup-dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add follow-up'}</button></footer>
    </form>
  </dialog>;
}
