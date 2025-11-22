# How to Run the Frontend and See How It Looks

## ✅ Database Safety Confirmed

The `run_pgbench_sweep.sh` script is **100% safe** - it connects to **standalone external Postgres** at `localhost:5432`, NOT to any Kubernetes pod. The script:
- Uses `PGHOST=localhost` and `PGPORT=5432` by default
- Prefers local pgbench when available
- Only connects to external Docker Postgres
- **Will NOT touch your database in any pod**

## Quick Start - See the Frontend

### Step 1: Install Dependencies (First Time Only)

```bash
cd webapp
pnpm install
```

### Step 2: Start the Development Server

```bash
pnpm dev
```

The webapp will start on **http://localhost:3001**

### Step 3: Open in Browser

Open your browser and go to: **http://localhost:3001**

## What You'll See

### 1. Landing Page (`/`)
- **Modern gradient background** (slate colors)
- **Centered hero section** with:
  - "Record Platform" branding
  - Large heading: "Operational console for Record Platform"
  - Description text
  - Two buttons: "Launch dashboard" and "Sign in"
- **Three feature cards** below:
  - "Streaming exports"
  - "AI insights"
  - "Tenant tuning"
- **Dark mode support** (toggle in top-right when logged in)

### 2. Login Page (`/login`)
- **Centered card** on gradient background
- **Email and password fields**
- **Two buttons**: "Sign in" and "Register"
- **Clean, modern styling** with rounded corners and shadows

### 3. Dashboard (`/dashboard`) - After Login
- **Left sidebar** with:
  - "RP" logo in brand color (indigo)
  - Navigation menu:
    - Overview
    - Records
    - Insights
    - Marketplace
    - Messages
    - Integrations
    - Settings
  - Kafka status indicator (placeholder)
  - "Sign out" button at bottom
- **Top header** with:
  - "Welcome back" greeting
  - Theme toggle (light/dark mode)
  - "Live mode" indicator
- **Main content area** with dashboard stats (placeholder cards)

### 4. Records Page (`/records`)
- **Search bar** at top
- **Action buttons**: "Add record" and "Export CSV → S3/R2"
- **Records list** with:
  - Artist and album name
  - Format and catalog number
  - Hover actions: "View" and "Delete"
  - Clickable rows to view details

### 5. Other Pages
- **Record Detail** (`/records/[id]`) - View/edit individual records
- **Create Record** (`/records/new`) - Form to add new records
- **Insights** (`/insights`) - AI price predictions
- **Marketplace** (`/market`) - eBay search integration
- **Messages** (`/messages`) - Real-time message stream
- **Settings** (`/settings`) - User settings
- **Integrations** (`/integrations`) - OAuth integrations

## Design Features

### Color Scheme
- **Primary brand color**: Indigo (`#6366f1`)
- **Background**: Light slate gradients (white → slate-50 → slate-100)
- **Dark mode**: Slate-950 → slate-900 → slate-950 gradients
- **Text**: Slate-900 (light) / White (dark)

### UI Components
- **Rounded corners**: `rounded-xl`, `rounded-2xl`
- **Subtle shadows**: Cards have soft shadows
- **Smooth transitions**: Hover effects and animations
- **Responsive**: Works on mobile and desktop
- **Accessible**: Proper contrast and focus states

### Typography
- **Headings**: Semibold, larger sizes
- **Body**: Regular weight, readable sizes
- **Labels**: Small, uppercase with tracking

## Testing Without Backend

The frontend will work visually even without the backend running! You'll see:
- ✅ All pages and layouts
- ✅ Navigation and routing
- ✅ Dark/light mode toggle
- ✅ UI components and styling
- ⚠️ API calls will fail (but won't break the UI)

## Testing With Backend

To see full functionality:

1. **Start backend services** (in separate terminals):
   ```bash
   # Terminal 1: API Gateway
   cd services/api-gateway && pnpm dev
   
   # Terminal 2: Auth Service
   cd services/auth-service && pnpm dev
   
   # Terminal 3: Records Service
   cd services/records-service && pnpm dev
   ```

2. **Start the webapp**:
   ```bash
   cd webapp && pnpm dev
   ```

3. **Test the flow**:
   - Go to http://localhost:3001
   - Click "Sign in"
   - Click "Register" to create an account
   - After login, you'll see the dashboard
   - Navigate to "Records" to see the list

## Screenshots You Can Take

1. **Landing page** - Marketing-style homepage
2. **Login page** - Clean authentication form
3. **Dashboard** - Sidebar navigation + main content
4. **Records list** - Searchable table with actions
5. **Dark mode** - Toggle to see dark theme

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or use a different port
PORT=3002 pnpm dev
```

### Build Errors
```bash
cd webapp
rm -rf .next node_modules
pnpm install
pnpm dev
```

### Styling Not Loading
Make sure Tailwind CSS is configured:
```bash
# Check if these files exist:
ls webapp/tailwind.config.ts
ls webapp/postcss.config.mjs
ls webapp/app/globals.css
```

## Next Steps

Once you see how it looks:
1. Test the navigation between pages
2. Try dark/light mode toggle
3. Test the search functionality (if backend is running)
4. Check responsive design on mobile/tablet
5. Review the component library in `webapp/components/`

Enjoy exploring the frontend! 🎨

