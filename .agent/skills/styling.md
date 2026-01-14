---
description: How to style UI components in DevBoot
---

# DevBoot UI Styling Guide

## Design System

DevBoot uses a modern dark theme with glassmorphism effects.

### Color Palette

```css
--bg-primary: #0f0f1a;
--bg-secondary: #1a1a2e;
--bg-tertiary: #16213e;
--text-primary: #ffffff;
--text-secondary: #9ca3af;
--text-muted: #6b7280;
--accent-primary: #6366f1;    /* Indigo */
--accent-secondary: #8b5cf6;  /* Purple */
--success: #10b981;           /* Green */
--warning: #f59e0b;           /* Amber */
--error: #ef4444;             /* Red */
```

### Typography

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
```

### Border Radius

```css
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;
```

## Component Patterns

### Buttons

```css
.btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
}
```

### Cards/Modals

```css
background: linear-gradient(180deg, #1e1e2e 0%, #181825 100%);
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 16px;
```

### Status Indicators

```css
/* Running - green glow */
background: #10b981;
box-shadow: 0 0 8px #10b981;

/* Error - red */
background: #ef4444;

/* Stopped - gray */
background: #6b7280;
```

## File Locations

- Global styles: `src/App.css`
- Component styles: `src/components/*.css`

## Adding New Component

1. Create `src/components/YourComponent.tsx`
2. Create `src/components/YourComponent.css`
3. Import CSS: `import './YourComponent.css';`
4. Follow existing patterns for consistency
