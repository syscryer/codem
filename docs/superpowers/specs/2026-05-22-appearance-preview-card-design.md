# Appearance Preview Card Design

**Scope**

- Only adjust the appearance settings page preview card at the top of the "外观" section.
- Do not change right workbench previews, chat timeline, tool cards, or other markdown/code surfaces.

**User-facing goal**

- Make the preview card reflect the chosen chat/code font family and font size more directly.
- Remove the diff-like red/green code comparison.
- Lighten the message background tone so the preview reads cleaner.

**Behavior**

- The two message preview pills use `--app-chat-font-family` and `--app-chat-font-size`.
- The code preview uses `--app-code-font-family` and `--app-code-font-size`.
- The code area renders as one neutral gray snippet card with line numbers.
- The preview keeps existing layout and accent presence, but avoids semantic red/green diff colors.

**Implementation boundary**

- Modify only:
  - `src/components/settings/AppearanceSettings.tsx`
  - `src/styles.css`

**Verification**

- Open the appearance settings page.
- Change chat font / chat size and confirm the message preview updates.
- Change code font / code size and confirm the code snippet updates.
- Confirm the preview shows one gray code card instead of two diff panes.
