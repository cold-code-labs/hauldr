"use client";

import { useActionState } from "react";
import { setupAction, type SetupState } from "./actions";

const initial: SetupState = {};

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, initial);

  return (
    <form action={action}>
      <div className="field">
        <label className="label" htmlFor="orgName">
          Organization name
        </label>
        <input
          id="orgName"
          name="orgName"
          className="input"
          placeholder="Acme Inc."
          autoComplete="organization"
          autoFocus
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="email">
          Master email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          placeholder="you@example.com"
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          placeholder="at least 8 characters"
          autoComplete="new-password"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          className="input"
          placeholder="••••••••••••"
          autoComplete="new-password"
        />
      </div>

      {state.error && <div className="form-error">{state.error}</div>}

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Setting up…" : "Create organization"}
      </button>
    </form>
  );
}
