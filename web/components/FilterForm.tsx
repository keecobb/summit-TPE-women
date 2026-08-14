"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode, CSSProperties } from "react";

// Drop-in replacement for a plain <form action="..."> filter/search form.
// A bare HTML <form> (even one that only navigates within the same Next.js
// app) triggers a real full browser navigation on submit -- Next's router
// doesn't intercept native form GETs the way it intercepts <Link> clicks or
// router.push() calls -- and a full navigation resets scroll to the top of
// the page. That's the "every time I click Update/Search/Filter I get
// dumped back at the top and have to scroll back down" complaint: every
// filter form site-wide (Team Fits, Teams, Players, TPE, Compare, Data) was
// a plain <form>, so this hit all of them.
//
// This component keeps the exact same props/semantics a plain <form> has
// (action, className, style, children -- same <input>/<select> field names
// still just work, multi-value fields like checkboxes still serialize to
// repeated query params the same way) but intercepts submit and does a
// client-side router.push({ scroll: false }) instead, which re-fetches this
// Server Component's data for the new URL without jumping the viewport.
export default function FilterForm({
  action,
  children,
  className,
  style,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && value !== "") params.append(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${action}?${qs}` : action, { scroll: false });
  }

  return (
    <form action={action} onSubmit={handleSubmit} className={className} style={style}>
      {children}
    </form>
  );
}
