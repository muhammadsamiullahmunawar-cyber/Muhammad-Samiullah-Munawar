<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Project rules

- Backend is Lovable Cloud; chat membership is enforced by RLS via `is_member()` security-definer functions — never trust client-side membership checks.
- User lookup happens only through exact-match RPCs (`start_direct_chat`, `create_group`) so profiles cannot be enumerated.
- Message edit window and immutability are enforced by a DB trigger; client `canEdit` only mirrors it for UI.
- UI strings go through `src/lib/i18n.tsx` (en/ur, RTL via `dir`); use logical CSS (`ms-`/`me-`/`start-`/`end-`) for RTL safety.
- Track multi-phase work in `roadmap.md`.
