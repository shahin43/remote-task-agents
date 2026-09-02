import { useEffect, useState, type PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import { getAuth, subscribe } from "../auth/session";
import { LoginControl } from "./login-control";

function initials(label: string | null): string {
  if (!label) return "?";
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function AppShell({ children }: PropsWithChildren) {
  const [auth, setAuth] = useState(getAuth());
  useEffect(() => subscribe(setAuth), []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="workspace">
          <span className="workspace-mark">A</span>
          <div>
            <strong>Agent Board</strong>
            <small>Sandboxed Agents</small>
          </div>
        </div>
        <nav>
          <p className="nav-group">Workspace</p>
          <NavLink to="/">&#9633; Board</NavLink>
          <NavLink to="/runs">&#8984; Runs</NavLink>
          <p className="nav-group">Automation</p>
          <NavLink to="/agents">&#9711; Agents</NavLink>
          <NavLink to="/repos">&#9734; Repos</NavLink>
          <NavLink to="/context">&#9636; Context</NavLink>
          <NavLink to="/memory">&#9826; Memory &amp; Skills</NavLink>
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{initials(auth.actorLabel)}</span>
          <span>{auth.actorLabel ?? "Not signed in"}</span>
        </div>
      </aside>
      <section className="content">
        <header className="topbar">
          <span className="crumb">Sandbox Agent Board &amp; Tasks</span>
          <LoginControl />
        </header>
        {children}
      </section>
    </div>
  );
}
