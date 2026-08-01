### Task 3: Add settings gear icon to ProviderPickerScreen

**Files:**

- Modify: `src/screens/ProviderPickerScreen.tsx:1-6,25-81,83-110`

**Interfaces:**

- Consumes: `navigation.navigate("Settings")` from RootNavigator (already defined)
- Produces: Settings gear icon in top-right corner of ProviderPickerScreen

- [ ] **Step 1: Add Settings icon import and navigation type**

```typescript
// src/screens/ProviderPickerScreen.tsx — update imports
import { Settings } from "lucide-react-native";
```

- [ ] **Step 2: Add settings button styles**

Add to the StyleSheet (inside the `useMemo`):

```typescript
header: {
  flexDirection: "row",
  justifyContent: "flex-end",
  marginBottom: spacing.md,
},
settingsButton: {
  padding: spacing.sm,
},
```

- [ ] **Step 3: Add settings button to the JSX**

Wrap the existing content and add a settings button at the top:

```typescript
return (
  <View style={styles.container}>
    <View style={styles.header}>
      <Pressable
        onPress={() => navigation.navigate("Settings")}
        style={styles.settingsButton}
        hitSlop={8}
      >
        <Settings color={colors.textMuted} size={22} />
      </Pressable>
    </View>

    <Text style={styles.title}>Desk Escape</Text>
    <Text style={styles.subtitle}>Choose your agent backend</Text>

    {/* ... existing Pressable cards unchanged ... */}
  </View>
);
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS
