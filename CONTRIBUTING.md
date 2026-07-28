# Contributing to Desk Escape

Guidelines for developers contributing to the project.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Bun](https://bun.sh/) >= 1.3.0
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- Android Studio (for Android builds) or Xcode (for iOS)
- A running [OpenCode](https://opencode.ai) server for testing

## Getting Started

```bash
# Clone the repository
git clone https://github.com/involvex/Desk-Escape.git
cd Desk-Escape

# Install dependencies (postinstall builds the terminal shell asset)
bun install

# Start the dev server
bun run start
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `bun run start` | Start Expo dev server |
| `bun run android` | Build and run on Android device/emulator |
| `bun run ios` | Build and run on iOS simulator |
| `bun run web` | Start web version |
| `bun run check` | Run lint + format + typecheck + dependency check + doctor |
| `bun run lint` | Run ESLint |
| `bun run lint:fix` | Run ESLint with auto-fix |
| `bun run format` | Run Prettier on all files |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run doctor` | Run Expo doctor diagnostics |
| `bun run check:install` | Verify native dependencies match Expo SDK versions |
| `bun run build:terminal-shell` | Rebuild the terminal shell HTML asset |
| `bun run android:clean` | Clean Android build artifacts |
| `bun run android:install` | Build and install release APK on connected device |
| `bun run validate:pty` | Validate PTY WebSocket connectivity |
| `bun run validate:terminal` | Validate terminal Android setup (PowerShell) |

## Code Style

### Linting & Formatting

- **ESLint 10** with `eslint-config-expo` flat config (`eslint.config.mjs`)
- **Prettier** for consistent formatting
- Run `bun run check` before committing to verify everything passes

### TypeScript

- Strict mode enabled (`tsconfig.json` has `"strict": true`)
- `noUncheckedIndexedAccess` enabled — array/object indexing returns `T | undefined`
- Path alias: `@/*` maps to `./src/*`

### Naming Conventions

- Components: `PascalCase` (e.g., `AgentChat`, `TerminalPanel`)
- Hooks: `camelCase` with `use` prefix (e.g., `useConnection`, `useTheme`)
- Contexts: `PascalCase` with `Context` suffix (e.g., `ConnectionContext`)
- Screen components: `PascalCase` with `Screen` suffix (e.g., `WorkspaceScreen`)

### File Organization

```
src/
├── api/           # SDK client, hooks, event bus, utilities
├── assets/        # Generated files (terminal shell HTML)
├── components/    # Reusable UI components
├── context/       # React context providers
├── hooks/         # Custom hooks
├── navigation/    # React Navigation configuration
├── screens/       # Screen-level components
├── services/      # Platform services (notifications)
├── types/         # TypeScript type definitions
└── utils/         # Pure utility functions
```

## Project Conventions

### Context Pattern

Each context follows this structure:
- File: `src/context/FooContext.tsx`
- Exports: `FooProvider` component, `useFoo()` hook
- The hook throws if used outside its provider
- All state management happens inside the provider
- Persisted values use `AsyncStorage` (general) or `SecureStore` (credentials)

### React Query

Server state is managed through React Query:
- Query keys are defined as functions in `src/api/hooks.ts`
- Mutations use `useMutation` with `onSettled` to refetch related queries
- `staleTime` varies by data freshness needs (30s for sessions, Infinity for messages)

### Styling

Components use `StyleSheet.create()` inside `useMemo` blocks that depend on theme tokens:

```tsx
const { colors, spacing, typography } = useTheme();

const styles = useMemo(
  () =>
    StyleSheet.create({
      container: {
        backgroundColor: colors.background,
        padding: spacing.md,
      },
      text: {
        color: colors.text,
        fontSize: typography.body,
      },
    }),
  [colors, spacing, typography],
);
```

This ensures styles update when the theme changes.

### Context Attachments

Files can be attached as context for the next prompt:
1. Long-press a file in `FileDrawer` → calls `addContextAttachment(path)`
2. Attachments are displayed in `WorkspaceToolbar`
3. When sending a prompt, attachments are included as text parts
4. Attachments are cleared after sending

## Dependency Management

### Expo Dependencies

Before bumping any Expo-related dependency:

```bash
bunx expo install --check
```

This verifies all native modules are compatible with the installed Expo SDK version. Do not add entries to `expo.install.exclude` in `app.json` without explicit testing.

### Key Version Pins

Some packages require exact version pins due to known regressions:
- `react-native-gesture-handler`: pinned to exact `2.31.1` (no `^` or `~`)
  - `2.31.2` regresses certain APIs
  - `3.x` fails on Windows due to MAX_PATH limits

### Terminal Shell Asset

The terminal shell HTML is generated at `postinstall` by `scripts/build-terminal-shell.mjs`. If you modify xterm.js dependencies, rebuild with:

```bash
bun run build:terminal-shell
```

## Testing Changes

### Android

```bash
bun run android
```

Requires Android Studio with SDK 35+ and a connected device or emulator.

### iOS

```bash
bun run ios
```

Requires Xcode with iOS 17+ simulator.

### Web

```bash
bun run web
```

Note: Terminal and PTY features may not work on web due to WebView limitations.

### Validation Scripts

```bash
# Validate PTY WebSocket connection works
bun run validate:pty

# Validate terminal setup on Android (PowerShell only)
bun run validate:terminal
```

## Commit Style

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add message search bar
fix: resolve offline queue flush race condition
docs: update architecture guide
chore: bump expo SDK to 57
```

## Pull Request Workflow

1. Create a feature branch from `main`
2. Make your changes following the conventions above
3. Run `bun run check` to verify lint, format, and types pass
4. Test on at least one platform (Android or iOS)
5. Submit a PR with a clear description of the changes

## AI Contributors

This project uses `AGENTS.md` for AI agent context. Key rules:
- Read `AGENTS.md` before making changes — it contains learned workspace facts
- Do not git commit or push unless explicitly requested
- Use `bun` for all package management and script execution
- Prefer `client.event.subscribe()` for live streaming over polling
- Do not adopt Expo Router — use React Navigation
