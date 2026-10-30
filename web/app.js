import { render, useState, useEffect } from './lib/deps.js';
import { html, Loading } from './lib/ui.js';
import { supabase, myProfile, signOut } from './lib/db.js';
import { Login, SetPassword } from './views/login.js';
import { Today } from './views/today.js';
import { Pipeline } from './views/pipeline.js';
import { DealPage } from './views/deal.js';
import { Contacts, ContactPage } from './views/contacts.js';
import { NewDeal } from './views/new-deal.js';
import { Leads } from './views/leads.js';
import { Installs, Handover, ProjectPage, Partners } from './views/installs.js';

// Bottom tabs per role; the first tab is that role's home screen.
const T = {
  leads: ['leads', 'Leads', '☎︎'], today: ['today', 'Today', '☀︎'], pipeline: ['pipeline', 'Pipeline', '▤'],
  new: ['new', 'Book', '+'], installs: ['installs', 'Installs', '⚙︎'], contacts: ['contacts', 'Contacts', '☺︎'],
};
const TABS = {
  setter: [T.leads, T.today, T.new, T.pipeline, T.contacts],
  rep: [T.today, T.pipeline, T.new, T.contacts],
  ops: [T.installs, T.today, T.contacts],
  admin: [T.today, T.leads, T.pipeline, T.installs, T.contacts],
};

function readRoute() {
  const [path, qs = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const [recovering, setRecovering] = useState(false);
  const route = useRoute();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    // Invite links arrive with type=invite in the URL fragment.
    if (location.hash.includes('type=invite') || location.hash.includes('type=recovery')) setRecovering(true);
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(session === null ? null : undefined); return; }
    myProfile().then(setProfile, () => setProfile(null));
  }, [session?.user?.id]);

  if (session === undefined) return html`<${Loading} />`;
  if (!session) return html`<${Login} />`;
  if (recovering) return html`<${SetPassword} onDone=${() => { setRecovering(false); location.hash = '/'; }} />`;
  if (profile === undefined) return html`<${Loading} />`;
  if (!profile || !profile.active) {
    return html`<main class="login"><div class="card stack">
      <h1>No access yet</h1>
      <p class="muted">You're signed in, but an admin hasn't set up your account. Ask them to add you.</p>
      <button onClick=${signOut}>Sign out</button>
    </div></main>`;
  }

  const role = profile.role;
  const seeAll = role === 'admin' || role === 'setter';
  const isOps = role === 'admin' || role === 'ops';
  const isSetter = role === 'admin' || role === 'setter';
  const home = TABS[role][0][0];
  const page = route.parts[0] || home;
  const id = route.parts[1];
  let body;
  switch (page) {
    case 'leads': body = isSetter ? html`<${Leads} />` : null; break;
    case 'pipeline': body = html`<${Pipeline} me=${profile} seeAll=${seeAll} />`; break;
    case 'deal': body = html`<${DealPage} id=${id} me=${profile} />`; break;
    case 'contacts': body = html`<${Contacts} />`; break;
    case 'contact': body = html`<${ContactPage} id=${id} />`; break;
    case 'new': body = role === 'ops' ? null
      : html`<${NewDeal} me=${profile} personId=${route.query.person} leadId=${route.query.lead} />`; break;
    case 'installs': body = isOps ? html`<${Installs} />` : null; break;
    case 'handover': body = isOps ? html`<${Handover} dealId=${id} />` : null; break;
    case 'project': body = isOps ? html`<${ProjectPage} id=${id} />` : null; break;
    case 'partners': body = html`<${Partners} canEdit=${isOps} />`; break;
    case 'today': body = html`<${Today} me=${profile} seeAll=${seeAll} />`; break;
    default: body = null;
  }
  if (!body) body = html`<p class="pad muted">That page isn't available. <a href=${'#/' + home}>Go to ${home}</a></p>`;

  const tab = ([path, label, icon]) => html`<a href=${'#/' + path} class=${page === path ? 'on' : ''}>
    <span aria-hidden="true">${icon}</span>${label}</a>`;

  return html`
    <header class="top">
      <strong>${profile.full_name.split(' ')[0]}</strong>
      <button class="link" onClick=${signOut}>Sign out</button>
    </header>
    <main class="page">${body}</main>
    <nav class="tabs" style=${`grid-template-columns: repeat(${TABS[role].length}, 1fr)`}>
      ${TABS[role].map(tab)}
    </nav>
    <div id="toast" role="status" aria-live="polite"></div>`;
}

render(html`<${App} />`, document.getElementById('app'));
