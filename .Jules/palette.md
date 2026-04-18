## $(date +%Y-%m-%d) - Added aria-label to SearchableSelect clear button
**Learning:** Found a pattern of missing ARIA labels on icon-only "Clear" buttons inside complex components like SearchableSelect.
**Action:** Always check icon-only buttons for `aria-label`, especially those conditionally rendered based on user input (like a search query being present).
