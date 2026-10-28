// Example project: multi-page SaaS site (React + TypeScript) with landing,
// pricing, sign-in/sign-up screens and a dashboard, using hash routing.
export function saasFiles(): { path: string; content: string }[] {
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northwind — Analytics for product teams</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`,
    },
    {
      path: "src/main.tsx",
      content: `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
    },
    {
      path: "src/router.ts",
      content: `import { useEffect, useState } from "react";

export type Route = "/" | "/pricing" | "/login" | "/signup" | "/dashboard";
const ROUTES: Route[] = ["/", "/pricing", "/login", "/signup", "/dashboard"];

function current(): Route {
  const h = window.location.hash.replace(/^#/, "") || "/";
  return (ROUTES as string[]).includes(h) ? (h as Route) : "/";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const on = () => {
      setRoute(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(to: Route) {
  window.location.hash = to;
}
`,
    },
    {
      path: "src/App.tsx",
      content: `import { useState } from "react";
import { useRoute } from "./router";
import { Nav } from "./components/Nav";
import { Landing } from "./pages/Landing";
import { Pricing } from "./pages/Pricing";
import { AuthPage } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const route = useRoute();
  const [user, setUser] = useState<string | null>(null);
  if (route === "/dashboard") return <Dashboard user={user ?? "Guest"} onSignOut={() => setUser(null)} />;
  return (
    <>
      <Nav route={route} user={user} />
      <main>
        {route === "/" && <Landing />}
        {route === "/pricing" && <Pricing />}
        {(route === "/login" || route === "/signup") && <AuthPage mode={route === "/login" ? "login" : "signup"} onAuthenticated={setUser} />}
      </main>
      <footer className="footer">
        <span>© 2026 Northwind Labs</span>
        <span className="muted">Demo project generated in Present 3D</span>
      </footer>
    </>
  );
}
`,
    },
    {
      path: "src/components/Nav.tsx",
      content: `import { useState } from "react";
import { Menu, X, BarChart3 } from "lucide-react";
import type { Route } from "../router";

export function Nav({ route, user }: { route: Route; user: string | null }) {
  const [open, setOpen] = useState(false);
  const link = (to: Route, label: string) => (
    <a href={"#" + to} className={route === to ? "active" : ""} onClick={() => setOpen(false)}>
      {label}
    </a>
  );
  return (
    <header className="nav">
      <a href="#/" className="brand" aria-label="Northwind home">
        <BarChart3 size={20} /> Northwind
      </a>
      <button className="menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      <nav className={open ? "links open" : "links"}>
        {link("/", "Product")}
        {link("/pricing", "Pricing")}
        {user ? <a href="#/dashboard" className="btn btn-primary">Dashboard</a> : (
          <>
            {link("/login", "Sign in")}
            <a href="#/signup" className="btn btn-primary" onClick={() => setOpen(false)}>Start free</a>
          </>
        )}
      </nav>
    </header>
  );
}
`,
    },
    {
      path: "src/pages/Landing.tsx",
      content: `import { motion } from "framer-motion";
import { Zap, ShieldCheck, LineChart, Users } from "lucide-react";

const features = [
  { icon: Zap, title: "Real-time events", body: "Stream product events with sub-second latency and query them instantly." },
  { icon: LineChart, title: "Funnels & retention", body: "Understand where users drop off and which cohorts come back." },
  { icon: Users, title: "Team workspaces", body: "Share dashboards, annotate launches and align on one source of truth." },
  { icon: ShieldCheck, title: "Privacy by default", body: "EU data residency, SSO and granular roles on every plan." },
];

export function Landing() {
  return (
    <>
      <section className="hero">
        <motion.p className="eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>New · Session replays</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          Product analytics your whole team understands
        </motion.h1>
        <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          Northwind turns raw events into answers: funnels, retention and revenue in one fast workspace.
        </motion.p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href="#/signup">Start free trial</a>
          <a className="btn btn-ghost btn-lg" href="#/pricing">See pricing</a>
        </div>
        <div className="hero-card" aria-hidden="true">
          {[42, 58, 51, 66, 72, 61, 80, 88, 76, 92, 97, 104].map((h, i) => (
            <motion.span key={i} className="bar" initial={{ height: 0 }} animate={{ height: h }} transition={{ delay: 0.2 + i * 0.04 }} />
          ))}
        </div>
      </section>
      <section className="features" aria-label="Features">
        {features.map((f) => (
          <article key={f.title} className="feature">
            <f.icon size={20} className="accent" />
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </section>
    </>
  );
}
`,
    },
    {
      path: "src/pages/Pricing.tsx",
      content: `import { useState } from "react";
import { Check } from "lucide-react";

const plans = [
  { name: "Starter", monthly: 0, desc: "For side projects", features: ["10k events / mo", "3 dashboards", "7-day history"] },
  { name: "Growth", monthly: 49, desc: "For growing teams", features: ["2M events / mo", "Unlimited dashboards", "Funnels & retention", "Slack alerts"], featured: true },
  { name: "Scale", monthly: 199, desc: "For organizations", features: ["50M events / mo", "SSO & audit log", "Data warehouse sync", "Priority support"] },
];

export function Pricing() {
  const [yearly, setYearly] = useState(true);
  return (
    <section className="pricing">
      <h1>Simple, usage-based pricing</h1>
      <div className="toggle" role="group" aria-label="Billing period">
        <button className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>Monthly</button>
        <button className={yearly ? "on" : ""} onClick={() => setYearly(true)}>Yearly · save 20%</button>
      </div>
      <div className="plans">
        {plans.map((p) => {
          const price = yearly ? Math.round(p.monthly * 0.8) : p.monthly;
          return (
            <article key={p.name} className={p.featured ? "plan featured" : "plan"}>
              {p.featured && <span className="badge">Most popular</span>}
              <h2>{p.name}</h2>
              <p className="muted">{p.desc}</p>
              <p className="price"><span>\${price}</span>/mo</p>
              <ul>{p.features.map((f) => <li key={f}><Check size={16} className="accent" />{f}</li>)}</ul>
              <a className={p.featured ? "btn btn-primary" : "btn btn-ghost"} href="#/signup">Choose {p.name}</a>
            </article>
          );
        })}
      </div>
    </section>
  );
}
`,
    },
    {
      path: "src/pages/Auth.tsx",
      content: `import { useState, type FormEvent } from "react";
import { navigate } from "../router";

/** Demo authentication screens. Validation is client-side only; no data leaves the preview. */
export function AuthPage({ mode, onAuthenticated }: { mode: "login" | "signup"; onAuthenticated: (name: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Passwords need at least 8 characters.");
    if (mode === "signup" && !name.trim()) return setError("Tell us your name.");
    setError(null);
    setBusy(true);
    setTimeout(() => {
      onAuthenticated(mode === "signup" ? name.trim() : email.split("@")[0]);
      navigate("/dashboard");
    }, 500);
  }

  return (
    <section className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="muted">{mode === "login" ? "Sign in to your workspace." : "14-day free trial. No credit card."}</p>
        {mode === "signup" && (
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <p className="muted small">
          {mode === "login" ? <>No account? <a href="#/signup">Sign up</a></> : <>Already registered? <a href="#/login">Sign in</a></>}
        </p>
      </form>
    </section>
  );
}
`,
    },
    {
      path: "src/pages/Dashboard.tsx",
      content: `import { useMemo, useState } from "react";
import { BarChart3, LogOut, TrendingUp, Users, Activity } from "lucide-react";

const days = Array.from({ length: 30 }, (_, i) => i);
function series(seed: number) {
  return days.map((d) => Math.round(400 + 180 * Math.sin((d + seed) / 4) + d * 14 + ((d * 37 + seed * 11) % 50)));
}

function Spark({ data }: { data: number[] }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => \`\${(i / (data.length - 1)) * 100},\${40 - ((v - min) / (max - min || 1)) * 36}\`).join(" ");
  return <svg viewBox="0 0 100 40" className="spark" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} /></svg>;
}

export function Dashboard({ user, onSignOut }: { user: string; onSignOut: () => void }) {
  const [range, setRange] = useState<7 | 30>(30);
  const visitors = useMemo(() => series(3).slice(-range), [range]);
  const signups = useMemo(() => series(9).map((v) => Math.round(v / 9)).slice(-range), [range]);
  const total = visitors.reduce((a, b) => a + b, 0);
  const conv = ((signups.reduce((a, b) => a + b, 0) / total) * 100).toFixed(1);
  const max = Math.max(...visitors);
  return (
    <div className="dash">
      <aside className="dash-side">
        <a href="#/" className="brand"><BarChart3 size={18} /> Northwind</a>
        <nav><a className="active">Overview</a><a>Funnels</a><a>Retention</a><a>Settings</a></nav>
        <button className="btn btn-ghost" onClick={() => { onSignOut(); window.location.hash = "/"; }}><LogOut size={16} /> Sign out</button>
      </aside>
      <section className="dash-main">
        <header className="dash-head">
          <div><h1>Good morning, {user}</h1><p className="muted">Here is how your product performed.</p></div>
          <div className="toggle">
            <button className={range === 7 ? "on" : ""} onClick={() => setRange(7)}>7 days</button>
            <button className={range === 30 ? "on" : ""} onClick={() => setRange(30)}>30 days</button>
          </div>
        </header>
        <div className="kpis">
          <article className="kpi"><Users size={16} /><span>Visitors</span><strong>{total.toLocaleString()}</strong><Spark data={visitors} /></article>
          <article className="kpi"><TrendingUp size={16} /><span>Sign-ups</span><strong>{signups.reduce((a, b) => a + b, 0).toLocaleString()}</strong><Spark data={signups} /></article>
          <article className="kpi"><Activity size={16} /><span>Conversion</span><strong>{conv}%</strong><Spark data={signups.map((s, i) => s / visitors[i])} /></article>
        </div>
        <article className="chart">
          <h2>Daily visitors</h2>
          <div className="bars" role="img" aria-label={\`Bar chart of daily visitors over \${range} days\`}>
            {visitors.map((v, i) => <span key={i} style={{ height: \`\${(v / max) * 100}%\` }} title={\`Day \${i + 1}: \${v}\`} />)}
          </div>
        </article>
      </section>
    </div>
  );
}
`,
    },
    {
      path: "src/styles.css",
      content: `:root {
  --bg: #0b0c10; --panel: #12141a; --line: #23262f; --fg: #eceef3; --muted: #9096a5; --accent: #7c8cff; --accent-2: #5be0c3;
  --radius: 12px; font-family: Inter, system-ui, sans-serif; color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.55; }
a { color: inherit; text-decoration: none; }
.muted { color: var(--muted); } .small { font-size: 13px; } .accent { color: var(--accent); }
.btn { display: inline-flex; align-items: center; gap: 8px; justify-content: center; padding: 9px 16px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--fg); font: inherit; font-weight: 500; cursor: pointer; transition: background .15s, border-color .15s, transform .15s; }
.btn:hover { border-color: #3a3f4c; } .btn:active { transform: translateY(1px); }
.btn:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #0b0c10; } .btn-primary:hover { background: #95a2ff; }
.btn-ghost { background: #ffffff08; } .btn-lg { padding: 12px 20px; } .btn-block { width: 100%; }
.nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; padding: 14px clamp(16px, 4vw, 48px); background: #0b0c10cc; backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -0.01em; }
.links { display: flex; align-items: center; gap: 24px; } .links a.active { color: var(--accent); }
.menu-btn { display: none; background: none; border: 0; color: var(--fg); }
.hero { max-width: 1040px; margin: 0 auto; padding: clamp(56px, 10vw, 120px) 24px 40px; text-align: center; }
.eyebrow { display: inline-block; padding: 4px 12px; border: 1px solid var(--line); border-radius: 999px; color: var(--accent-2); font-size: 13px; }
.hero h1 { font-size: clamp(36px, 6vw, 68px); line-height: 1.05; letter-spacing: -0.035em; margin: 20px auto 16px; max-width: 14ch; }
.lede { color: var(--muted); font-size: clamp(16px, 2vw, 19px); max-width: 56ch; margin: 0 auto; }
.cta-row { display: flex; gap: 12px; justify-content: center; margin-top: 32px; flex-wrap: wrap; }
.hero-card { margin: 56px auto 0; height: 160px; max-width: 720px; display: flex; align-items: flex-end; gap: 10px; padding: 24px; border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(180deg, #151823, #0f1117); }
.hero-card .bar { flex: 1; border-radius: 6px 6px 2px 2px; background: linear-gradient(180deg, var(--accent), #4b56c9); }
.features { max-width: 1040px; margin: 0 auto; padding: 40px 24px 96px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.feature { padding: 22px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.feature h3 { margin: 12px 0 6px; font-size: 16px; } .feature p { margin: 0; color: var(--muted); font-size: 14px; }
.pricing { max-width: 1040px; margin: 0 auto; padding: 72px 24px; text-align: center; }
.pricing h1 { font-size: clamp(30px, 4vw, 44px); letter-spacing: -0.03em; }
.toggle { display: inline-flex; padding: 4px; gap: 4px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.toggle button { border: 0; background: none; color: var(--muted); padding: 6px 12px; border-radius: 7px; font: inherit; cursor: pointer; } .toggle button.on { background: #ffffff12; color: var(--fg); }
.plans { margin-top: 40px; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; text-align: left; }
.plan { position: relative; padding: 28px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); display: flex; flex-direction: column; gap: 6px; }
.plan.featured { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.plan h2 { margin: 0; font-size: 18px; } .badge { position: absolute; top: 16px; right: 16px; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #7c8cff22; color: var(--accent); }
.price { margin: 12px 0; color: var(--muted); } .price span { font-size: 40px; font-weight: 700; color: var(--fg); letter-spacing: -0.03em; }
.plan ul { list-style: none; padding: 0; margin: 0 0 20px; display: grid; gap: 8px; flex: 1; } .plan li { display: flex; gap: 8px; align-items: center; font-size: 14px; }
.auth { min-height: calc(100vh - 140px); display: grid; place-items: center; padding: 48px 16px; }
.auth-card { width: min(400px, 100%); padding: 32px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); display: grid; gap: 14px; }
.auth-card h1 { margin: 0; font-size: 24px; } .auth-card label { display: grid; gap: 6px; font-size: 14px; color: var(--muted); }
.auth-card input { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: #0b0c10; color: var(--fg); font: inherit; }
.error { margin: 0; color: #ff8a8a; font-size: 14px; }
.footer { display: flex; justify-content: space-between; gap: 16px; padding: 24px clamp(16px, 4vw, 48px); border-top: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
.dash { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.dash-side { border-right: 1px solid var(--line); padding: 20px; display: flex; flex-direction: column; gap: 24px; background: var(--panel); }
.dash-side nav { display: grid; gap: 4px; flex: 1; } .dash-side nav a { padding: 8px 10px; border-radius: 8px; color: var(--muted); cursor: pointer; } .dash-side nav a.active, .dash-side nav a:hover { background: #ffffff0d; color: var(--fg); }
.dash-main { padding: clamp(20px, 3vw, 40px); display: grid; gap: 20px; align-content: start; }
.dash-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; } .dash-head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.kpi { padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); display: grid; gap: 4px; color: var(--muted); font-size: 13px; }
.kpi strong { color: var(--fg); font-size: 28px; letter-spacing: -0.02em; }
.spark { width: 100%; height: 40px; } .spark polyline { fill: none; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.chart { padding: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); } .chart h2 { margin: 0 0 16px; font-size: 15px; }
.bars { height: 220px; display: flex; align-items: flex-end; gap: 4px; } .bars span { flex: 1; min-width: 2px; border-radius: 4px 4px 1px 1px; background: linear-gradient(180deg, var(--accent-2), #2f8f7c); }
@media (max-width: 760px) {
  .menu-btn { display: inline-flex; }
  .links { display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column; align-items: stretch; padding: 16px; gap: 12px; background: var(--bg); border-bottom: 1px solid var(--line); }
  .links.open { display: flex; }
  .dash { grid-template-columns: 1fr; } .dash-side { flex-direction: row; align-items: center; justify-content: space-between; } .dash-side nav { display: none; }
}
`,
    },
  ];
}
