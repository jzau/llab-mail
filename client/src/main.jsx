import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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
      <nav>{[['accounts','Accounts'],['domains','Domains'],['brevo','Brevo relay']].map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="aside-foot"><span className="status-dot" />Services configured<button className="link" onClick={logout}>Sign out</button></div>
    </aside>
    <main className="content">
      <header><div><p className="eyebrow">OPERATIONS</p><h1>{tab === 'brevo' ? 'Brevo relay' : tab[0].toUpperCase() + tab.slice(1)}</h1></div><div className="metrics"><span><b>{state.domains.length}</b> domains</span><span><b>{state.accounts.length}</b> accounts</span></div></header>
      {notice && <div className="notice">{notice}</div>}{error && <div className="error banner">{error}</div>}
      {tab === 'accounts' && <Accounts state={state} action={action} />}
      {tab === 'domains' && <Domains state={state} action={action} />}
      {tab === 'brevo' && <Brevo value={state.brevo} action={action} />}
    </main>
  </div>;
}

function Accounts({ state, action }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  async function add(e) { e.preventDefault(); await action(() => api('/accounts', { method:'POST', body:JSON.stringify({email,password}) }), 'Account added'); setEmail(''); setPassword(''); }
  return <><section className="panel form-panel"><div><h2>Add employee</h2><p>One credential works for both POP3 and SMTP.</p></div><form className="inline-form" onSubmit={add}><input type="email" required placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)} /><input type="password" required minLength="10" placeholder="10+ character password" value={password} onChange={e=>setPassword(e.target.value)} /><button>Add account</button></form></section>
  <section className="panel"><div className="panel-title"><h2>Employee accounts</h2><span>{state.accounts.length} total</span></div><div className="table"><div className="tr head"><span>Address</span><span>Status</span><span>Created</span><span /></div>{state.accounts.map(a=><div className="tr" key={a.id}><strong>{a.email}</strong><span><Pill enabled={a.enabled}/></span><span className="muted">{new Date(a.createdAt+'Z').toLocaleDateString()}</span><span className="row-actions"><button className="subtle" onClick={()=>{const password=prompt(`New password for ${a.email} (10+ characters)`);if(password)action(()=>api(`/accounts/${a.id}`,{method:'PATCH',body:JSON.stringify({password})}),'Password reset')}}>Reset</button><button className="subtle" onClick={()=>action(()=>api(`/accounts/${a.id}`,{method:'PATCH',body:JSON.stringify({enabled:!a.enabled})}), a.enabled?'Account paused':'Account enabled')}>{a.enabled?'Pause':'Enable'}</button><button className="danger" onClick={()=>confirm(`Delete ${a.email}?`)&&action(()=>api(`/accounts/${a.id}`,{method:'DELETE'}),'Account deleted')}>Delete</button></span></div>)}{!state.accounts.length&&<div className="empty">No employee accounts yet.</div>}</div></section></>;
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

function App(){const [auth,setAuth]=useState(null);useEffect(()=>{api('/me').then(()=>setAuth(true)).catch(()=>setAuth(false));},[]);if(auth===null)return <main className="loading">Loading…</main>;return auth?<Dashboard onLogout={()=>setAuth(false)}/>:<Login onLogin={()=>setAuth(true)}/>;}
createRoot(document.getElementById('root')).render(<App/>);
