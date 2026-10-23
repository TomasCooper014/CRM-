import { render, useState, useEffect } from './lib/deps.js';
import { html, Loading } from './lib/ui.js';
import { supabase, myProfile, signOut } from './lib/db.js';
import { Login, SetPassword } from './views/login.js';
import { Today } from './views/today.js';
import { Pipeline } from './views/pipeline.js';
import { DealPage } from './views/deal.js';
import { Contacts, ContactPage } from './views/contacts.js';
import { NewDeal } from './views/new-deal.js';

function readRoute() {
  const [path, qs = ''] = (location.hash.replace(/^#/, '') || '/today').split('?');
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
  if (recovering) return html`<${SetPassword} onDone=${() => { setRecovering(false); location.hash = '/today'; }} />`;
  if (profile === undefined) return html`<${Loading} />`;
  if (!profile || !profile.active) {
    return html`<main class="login"><div class="card stack">
      <h1>No access yet</h1>
      <p class="muted">You're signed in, but an admin hasn't set up your account. Ask them to add you.</p>
      <button onClick=${signOut}>Sign out</button>
    </div></main>`;
  }

  const [page, id] = route.parts;
  const seeAll = profile.role === 'admin' || profile.role === 'setter';
  let body;
  switch (page) {
    case 'pipeline': body = html`<${Pipeline} me=${profile} seeAll=${seeAll} />`; break;
    case 'deal': body = html`<${DealPage} id=${id} me=${profile} />`; break;
    case 'contacts': body = html`<${Contacts} />`; break;
    case 'contact': body = html`<${ContactPage} id=${id} />`; break;
    case 'new': body = html`<${NewDeal} me=${profile} personId=${route.query.person} />`; break;
    default: body = html`<${Today} me=${profile} seeAll=${seeAll} />`;
  }

  const tab = (path, label, icon) => html`<a href=${'#/' + path} class=${page === path || (!page && path === 'today') ? 'on' : ''}>
    <span aria-hidden="true">${icon}</span>${label}</a>`;

  return html`
    <header class="top">
      <strong>${profile.full_name.split(' ')[0]}</strong>
      <button class="link" onClick=${signOut}>Sign out</button>
    </header>
    <main class="page">${body}</main>
    <nav class="tabs">
      ${tab('today', 'Today', '☀︎')}
      ${tab('pipeline', 'Pipeline', '▤')}
      ${tab('new', 'New', '+')}
      ${tab('contacts', 'Contacts', '☺︎')}
    </nav>
    <div id="toast" role="status" aria-live="polite"></div>`;
}

render(html`<${App} />`, document.getElementById('app'));
