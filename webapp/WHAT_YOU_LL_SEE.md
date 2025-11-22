# What the Frontend Looks Like

## 🎨 Design Overview

The frontend uses a **modern, clean design** with:
- **Tailwind CSS** for styling
- **shadcn/ui** components for consistency
- **Dark mode support** (toggle in header)
- **Responsive design** (works on mobile/tablet/desktop)
- **Smooth animations** and transitions

## 🏠 Landing Page (`/`)

**Visual Description:**
- Gradient background (light slate colors)
- Large centered white card with:
  - Small uppercase "RECORD PLATFORM" text in brand color
  - Big heading: "Operational console for Record Platform"
  - Description text
  - Two buttons: "Launch dashboard" (primary) and "Sign in" (secondary)
- Three feature cards in a row below:
  - "Streaming exports"
  - "AI insights"  
  - "Tenant tuning"

**Colors:**
- Background: White → Slate-50 → Slate-100 gradient
- Text: Slate-900 (dark gray)
- Brand color: Indigo (#5C6FF8)

## 🔐 Login Page (`/login`)

**Visual Description:**
- Full-screen gradient background
- Centered white card (max-width: 28rem)
- Card contains:
  - "Sign in" title
  - "Enter your credentials..." description
  - Email input field
  - Password input field
  - Two buttons side-by-side: "Sign in" and "Register"
  - Error message area (if login fails)

**Styling:**
- Rounded corners (rounded-xl)
- Subtle shadow
- Clean input fields with focus states

## 📊 Dashboard (`/dashboard`)

**Layout:**
- **Left Sidebar** (64 units wide, hidden on mobile):
  - "RP" logo in indigo circle
  - "Record Platform" title + "Catalog Intelligence" subtitle
  - Navigation menu (7 items):
    - Overview
    - Records
    - Insights
    - Marketplace
    - Messages
    - Integrations
    - Settings
  - Kafka status box (green "Placeholder" indicator)
  - "Sign out" button at bottom

- **Top Header**:
  - "Welcome back" greeting
  - "Live mode" badge (hidden on mobile)
  - Theme toggle button (sun/moon icon)

- **Main Content**:
  - Dashboard stats cards (placeholder)
  - White background with padding

**Colors:**
- Sidebar: White/80 with border
- Header: Transparent with backdrop blur
- Content: White background

## 📝 Records Page (`/records`)

**Visual Description:**
- **Top Section**:
  - "Records" heading + description
  - Two buttons: "Add record" (primary) and "Export CSV → S3/R2" (secondary)
  
- **Search Card**:
  - Search input field
  - "Search" button
  - "Clear" button (ghost style)
  - Status message area

- **Results Card**:
  - List of records (if any)
  - Each record shows:
    - Artist — Album name (bold)
    - Format · Catalog number (smaller, gray)
    - Hover reveals: "View" and "Delete" buttons
  - Empty state: "No records found for this query"

**Interactions:**
- Click row → Navigate to record detail
- Hover row → Show action buttons
- Click "Delete" → Confirmation dialog

## 🎯 Other Pages

### Record Detail (`/records/[id]`)
- Form to view/edit record fields
- Save/Cancel buttons

### Create Record (`/records/new`)
- Form with fields: artist, name, format, catalog number
- Submit button

### Insights (`/insights`)
- AI price prediction interface
- Charts/graphs (placeholder)

### Marketplace (`/market`)
- eBay search interface
- Search results grid

### Messages (`/messages`)
- Real-time message stream
- SSE connection status

### Settings (`/settings`)
- User settings form
- Save button

### Integrations (`/integrations`)
- OAuth integration buttons
- Connection status

## 🌓 Dark Mode

When dark mode is enabled:
- Background: Slate-950 → Slate-900 → Slate-950 gradient
- Text: White
- Cards: Slate-900 with white/10 borders
- All colors invert appropriately

## 📱 Responsive Design

- **Desktop**: Full sidebar + main content
- **Tablet**: Collapsed sidebar or hamburger menu
- **Mobile**: Stacked layout, hidden sidebar

## 🎨 Component Library

All components use consistent styling:
- **Buttons**: Rounded, with hover states
- **Cards**: White background, subtle shadow, rounded corners
- **Inputs**: Rounded, with focus ring
- **Links**: Brand color, hover underline

## 🚀 To See It Live

```bash
cd webapp
pnpm install
pnpm dev
```

Then open: **http://localhost:3001**

You'll see the landing page immediately - no backend needed for visual testing!
