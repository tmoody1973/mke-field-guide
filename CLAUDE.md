@AGENTS.md

# Clean Code Standards

All code produced in this project must follow these clean code principles. These are non-negotiable defaults — not suggestions.

## Naming

- Every variable, function, and class name must clearly communicate its purpose. No single-letter names, no abbreviations unless universally understood (e.g., `id`, `url`).
- Use `numberOfUsers` not `n`. Use `calculateShippingCost` not `calc`.

## Functions

- Each function does ONE thing (Single Responsibility Principle). If you can describe what a function does using "and," split it.
- Keep functions under 20 lines. If longer, extract helper functions.
- Prefer small, composable functions over large monolithic ones.

## Comments

- Code should be self-explanatory. Comments explain WHY, never WHAT or HOW.
- Bad: `// Loop through users` — Good: `// Retry failed users from the last sync batch`
- Delete comments that restate the code. Outdated comments are worse than no comments.

## Formatting & Consistency

- Use consistent indentation (2 or 4 spaces — pick one, never mix).
- Group related logic with blank lines. Separate concerns visually.
- Use Prettier/ESLint or equivalent formatter. Every file should look like the same person wrote it.

## No Hardcoded Values

- Extract magic numbers and strings into named constants or config.
- Bad: `if (users >= 100)` — Good: `if (users >= MAX_USERS)`

## Project Structure

- Organize by concern: `components/`, `services/`, `utils/`, `tests/`.
- Keep test files outside `src/` in a mirrored structure.
- Never dump everything in one directory.

## Error Handling

- Fail fast. Throw meaningful errors with clear messages.
- Use try/catch blocks. Never silently swallow errors.
- Log like you're documenting a crime scene: precise, relevant, minimal.

## Testing

- Write unit tests for every function with logic.
- Tests should be as clean as production code.
- Test edge cases, not just the happy path.

## Dependency Injection

- Pass dependencies as arguments rather than hardcoding them.
- This makes code testable and swappable.

## The Boy Scout Rule

- Leave every file cleaner than you found it.
- When touching existing code: rename unclear variables, extract messy functions, remove dead code.

## Open/Closed Principle

- Design for extension, not modification. Use polymorphism and composition.
- Adding a new feature should not require rewriting existing working code.

## Code Smells to Fix on Sight

- Duplicated logic → extract into a shared function
- God objects doing everything → split responsibilities
- Long parameter lists → use an options/config object
- Nested conditionals 3+ levels deep → extract or invert early returns
