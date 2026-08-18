import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './routing.css';

async function api(path, options = {}) {
  const response = await fetch(`/api/admin${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await api('/login', { method: 'POST', body: JSON.stringify({ password }) }); onLogin(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <section className="login-card">
      <div className="mark">MR</div>
      <p className="eyebrow">PRIVATE CONTROL PLANE</p>
      <h1>Mail Relay</h1>
      <p className="muted">Manage domains, employee credentials, and Brevo delivery from one place.</p>
      <form onSubmit={submit}>
        <label>Admin password<input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" /></label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  </main>;
}

function Pill({ enabled }) { return <span className={`pill ${enabled ? 'on' : 'off'}`}>{enabled ? 'Active' : 'Paused'}</span>; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(); }
function RoutingPill({ status }) { const labels={active:'Routing active',pending_verification:'Awaiting verification',error:'Retrying',expired:'Verification expired',not_configured:'Not configured'}; return <span className={`route-pill ${status || 'not_configured'}`}>{labels[status] || status || 'Not configured'}</span>; }

function Dashboard({ onLogout }) {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('accounts');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function load() { setState(await api('/state')); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  async function action(fn, message) {
    setError(''); setNotice('');
    try { await fn(); await load(); setNotice(message); setTimeout(() => setNotice(''), 2500); }
    catch (e) { setError(e.message); }
  }
  async function logout() { await api('/logout', { method: 'POST' }); onLogout(); }
  if (!state) return <main className="loading">Loading relay configuration…</main>;
  return <div className="app-shell">
    <aside>
      <div className="brand"><div className="mark small">MR</div><div><strong>Mail Relay</strong><span>Admin console</span></div></div>
      <nav>{[['accounts','Accounts'],['domains','Domains'],['brevo','Brevo relay'],['cloudflare','Cloudflare routing']].map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="aside-foot"><span className="status-dot" />Services configured<button className="link" onClick={logout}>Sign out</button></div>
    </aside>
    <main className="content">
      <header><div><p className="eyebrow">OPERATIONS</p><h1>{tab === 'brevo' ? 'Brevo relay' : tab === 'cloudflare' ? 'Cloudflare routing' : tab[0].toUpperCase() + tab.slice(1)}</h1></div><div className="metrics"><span><b>{state.domains.length}</b> domains</span><span><b>{state.accounts.length}</b> accounts</span></div></header>
      {notice && <div className="notice">{notice}</div>}{error && <div className="error banner">{error}</div>}
      {tab === 'accounts' && <Accounts state={state} action={action} />}
      {tab === 'domains' && <Domains state={state} action={action} />}
      {tab === 'brevo' && <Brevo value={state.brevo} action={action} />}
      {tab === 'cloudflare' && <Cloudflare value={state.cloudflare} action={action} />}
    </main>
  </div>;
}

function Accounts({ state, action }) {
  const availableDomains = state.domains.filter((domain) => domain.enabled);
  const [localPart, setLocalPart] = useState(''); const [domain, setDomain] = useState(availableDomains[0]?.name || ''); const [forwardTo, setForwardTo] = useState(''); const [password, setPassword] = useState('');
  useEffect(() => { if (!availableDomains.some((item) => item.name === domain)) setDomain(availableDomains[0]?.name || ''); }, [state.domains, domain]);
  async function add(e) { e.preventDefault(); await action(() => api('/accounts', { method:'POST', body:JSON.stringify({localPart,domain,forwardTo,password}) }), 'Account added; verification email requested'); setLocalPart(''); setForwardTo(''); setPassword(''); }
  function setForwarding(account){const forwardTo=prompt(`Forward ${account.email} to:`);if(forwardTo)action(()=>api(`/accounts/${account.id}`,{method:'PATCH',body:JSON.stringify({forwardTo})}),'Verification email requested')}
  return <><section className="panel form-panel"><div><h2>Add employee</h2><p>Creates mail credentials and starts Cloudflare destination verification.</p></div><form className="inline-form account-form" onSubmit={add}><input required maxLength="64" pattern="[^@]+" placeholder="name" aria-label="Account name" value={localPart} onChange={e=>setLocalPart(e.target.value)} /><select required aria-label="Company domain" value={domain} onChange={e=>setDomain(e.target.value)} disabled={!availableDomains.length}><option value="" disabled>Select domain</option>{availableDomains.map(item=><option key={item.id} value={item.name}>@{item.name}</option>)}</select><input type="email" required maxLength="90" placeholder="Personal email" aria-label="Personal email" value={forwardTo} onChange={e=>setForwardTo(e.target.value)} /><input type="password" required placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} /><button disabled={!availableDomains.length}>Add account</button></form></section>
  <section className="panel"><div className="panel-title"><h2>Employee accounts</h2><span>{state.accounts.length} total</span></div><div className="table accounts-table"><div className="tr head"><span>Address</span><span>Forward to</span><span>Routing</span><span>Status</span><span>Created</span><span /></div>{state.accounts.map(a=><div className="tr" key={a.id}><strong>{a.email}</strong><span className="muted">{a.forwardTo||'—'}</span><span title={a.routingError||''}><RoutingPill status={a.routingStatus}/></span><span><Pill enabled={a.enabled}/></span><span className="muted">{formatDate(a.createdAt)}</span><span className="row-actions">{!a.forwardTo&&<button className="subtle" onClick={()=>setForwarding(a)}>Forward</button>}{['error','expired'].includes(a.routingStatus)&&<button className="subtle" onClick={()=>action(()=>api(`/accounts/${a.id}/routing/retry`,{method:'POST'}),'Routing check restarted')}>Retry</button>}<button className="subtle" onClick={()=>{const password=prompt(`New password for ${a.email}`);if(password)action(()=>api(`/accounts/${a.id}`,{method:'PATCH',body:JSON.stringify({password})}),'Password reset')}}>Reset</button><button className="subtle" onClick={()=>action(()=>api(`/accounts/${a.id}`,{method:'PATCH',body:JSON.stringify({enabled:!a.enabled})}), a.enabled?'Account paused':'Account enabled')}>{a.enabled?'Pause':'Enable'}</button><button className="danger" onClick={()=>confirm(`Delete ${a.email} and its Cloudflare route?`)&&action(()=>api(`/accounts/${a.id}`,{method:'DELETE'}),'Account and route deleted')}>Delete</button></span></div>)}{!state.accounts.length&&<div className="empty">No employee accounts yet.</div>}</div></section></>;
}

function Domains({ state, action }) {
  const [name,setName]=useState('');
  async function add(e){e.preventDefault();await action(()=>api('/domains',{method:'POST',body:JSON.stringify({name})}),'Domain added');setName('');}
  return <><section className="panel form-panel"><div><h2>Add company domain</h2><p>Add it here after authenticating it in Brevo.</p></div><form className="inline-form short" onSubmit={add}><input required placeholder="company.com" value={name} onChange={e=>setName(e.target.value)}/><button>Add domain</button></form></section><section className="panel"><div className="panel-title"><h2>Allowed domains</h2><span>{state.domains.length} total</span></div><div className="table"><div className="tr domain head"><span>Domain</span><span>Status</span><span /></div>{state.domains.map(d=><div className="tr domain" key={d.id}><strong>{d.name}</strong><span><Pill enabled={d.enabled}/></span><span className="row-actions"><button className="subtle" onClick={()=>action(()=>api(`/domains/${d.id}`,{method:'PATCH',body:JSON.stringify({enabled:!d.enabled})}),d.enabled?'Domain paused':'Domain enabled')}>{d.enabled?'Pause':'Enable'}</button><button className="danger" onClick={()=>confirm(`Delete ${d.name}?`)&&action(()=>api(`/domains/${d.id}`,{method:'DELETE'}),'Domain deleted')}>Delete</button></span></div>)}{!state.domains.length&&<div className="empty">Add your first company domain.</div>}</div></section></>;
}

function Brevo({ value, action }) {
  const [form,setForm]=useState({...value,key:''}); const set=(key)=>(e)=>setForm({...form,[key]:e.target.value});
  async function save(e){e.preventDefault();await action(()=>api('/brevo',{method:'PUT',body:JSON.stringify(form)}),'Brevo settings saved');setForm({...form,key:''});}
  return <section className="panel settings"><div className="panel-title"><div><h2>Upstream SMTP</h2><p>Employees never see these credentials. The SMTP key is encrypted on disk.</p></div><Pill enabled={value.keyConfigured}/></div><form onSubmit={save}><div className="grid"><label>SMTP host<input value={form.host} onChange={set('host')} required /></label><label>Port<input type="number" min="1" max="65535" value={form.port} onChange={set('port')} required /></label></div><label>SMTP login<input value={form.login} onChange={set('login')} placeholder="your Brevo SMTP login" required /></label><label>SMTP key<input type="password" value={form.key} onChange={set('key')} placeholder={value.keyConfigured?'Leave blank to keep existing key':'Enter Brevo SMTP key'} /></label><button>Save relay settings</button></form><div className="callout"><strong>Delivery rule</strong><p>Authenticated employees can send only from their own address. Messages are then submitted to Brevo using this technical login.</p></div></section>;
}

function Cloudflare({ value, action }) {
  const [form,setForm]=useState({...value,apiToken:''}); const set=(key)=>(e)=>setForm({...form,[key]:e.target.value});
  async function save(e){e.preventDefault();await action(()=>api('/cloudflare',{method:'PUT',body:JSON.stringify(form)}),'Cloudflare settings saved; unfinished routes queued');setForm({...form,apiToken:''});}
  return <section className="panel settings"><div className="panel-title"><div><h2>Email Routing API</h2><p>Creates destinations, checks verification every minute for 24 hours, then creates routing rules.</p></div><Pill enabled={value.tokenConfigured}/></div><form onSubmit={save}><label>Account ID<input value={form.accountId} onChange={set('accountId')} placeholder="Cloudflare account ID" required /></label><label>API token<input type="password" value={form.apiToken} onChange={set('apiToken')} placeholder={value.tokenConfigured?'Leave blank to keep existing token':'Cloudflare API token'} /></label><button>Save Cloudflare settings</button></form><div className="callout"><strong>Required token permissions</strong><p>Zone Read, Email Routing Addresses Write, and Email Routing Rules Write for the domains managed here.</p></div></section>;
}

function App(){const [auth,setAuth]=useState(null);useEffect(()=>{api('/me').then(()=>setAuth(true)).catch(()=>setAuth(false));},[]);if(auth===null)return <main className="loading">Loading…</main>;return auth?<Dashboard onLogout={()=>setAuth(false)}/>:<Login onLogin={()=>setAuth(true)}/>;}
createRoot(document.getElementById('root')).render(<App/>);
