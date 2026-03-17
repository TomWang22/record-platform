# Terminal slow / "docker" profile fix

## Why the terminal lags or "loads Docker"

If your **Terminal window title** shows **"docker"** (e.g. "Terminal — docker -bash"), you're using a **Terminal.app profile** named "docker". That profile can:

- Run a startup command that touches Docker (e.g. `docker ps` or a Docker helper)
- Be configured to "Run inside Docker" or attach to a container

That makes every new terminal tab/window slow because Docker (or Colima) is involved before you see a prompt.

## Fix once and for all

### 0. This workspace (record-platform) — automatic

**In this repo**, the integrated terminal is forced to use **bash** (no Docker, no Kind). Colima k3s only—Kind is not used.

- **File:** `.vscode/settings.json` sets `terminal.integrated.defaultProfile.osx` and `automationProfile.osx` to **bash** (profile: `/bin/bash -l`). Docker and Kind are not run by default.
- **Effect:** New terminals in Cursor use local bash so you can run `./scripts/run-preflight-scale-and-all-suites.sh` and other scripts without Docker/Kind starting.
- **If the terminal still shows "docker" or "kind":** In Cursor go to **Settings → Terminal → Default Profile** and choose **bash** (or "Local (no Docker/Kind)"). Your Cursor user settings now default to bash; reload the window (Cmd+Shift+P → "Developer: Reload Window") so new terminals use it.
- Docker only when you need it: run `docker exec -it <container> bash` from this terminal or use the Docker extension.

### 1. Stop using the "docker" profile for normal work (other apps / Terminal.app)

- **Terminal.app:** **Preferences (⌘,) → Profiles.** Select a different profile (e.g. **Basic** or **Unnamed**) and click **Default** so new windows use it. Use the "docker" profile only when you actually need a Docker shell.
- **Cursor integrated terminal:** Check **Settings → Terminal → Profile** (or `terminal.integrated.defaultProfile.osx`). If it's set to "docker", change it to **zsh** or **bash** so the integrated terminal doesn’t start a Docker session.

### 2. Bash on macOS (root cause if bash is slow or broken)

- **Cursor runs** `/bin/bash -l`, so **`~/.bash_profile`** runs on every new terminal tab. If that file sources Docker, Colima, NVM, or slow tools, the terminal will lag or error.
- **Check:** `time bash -l -c exit` — if &gt;0.5s or errors, trim **`~/.bash_profile`** and **`~/.bashrc`** (comment out or guard heavy blocks with `[ -n "$RUN_FULL_ENV" ] && ...`).
- **Minimal profile:** Use `scripts/bash-profile-minimal.example` as a safe starting point. Backup first: `cp ~/.bash_profile ~/.bash_profile.backup`, then copy or merge the example so your login shell stays fast and doesn’t depend on Docker/Colima at startup.
- **macOS note:** System bash is 3.2; avoid bash 4+ syntax in `.bash_profile` if you use system bash, or point the workspace terminal to Homebrew bash (`/opt/homebrew/bin/bash`) in `.vscode/settings.json` if you prefer.

### 3. Remove Docker from "docker" profile startup (if you keep the profile)

- **Terminal.app:** Edit the "docker" profile → **Shell** tab. If "Run command" or "Run inside Docker" is set, clear it or point it to a plain shell (e.g. `/bin/zsh -l`) so the profile doesn’t run Docker on startup.

### 4. Shell config (zsh, for reference)

- `.zprofile`: brew shellenv runs once (duplicates removed).
- `.zshrc`: minimal; KUBECONFIG set only when Colima kubeconfig exists; NVM/kind in `~/.zshrc.d/` (source on demand).
- Measure startup: `time zsh -i -c exit`.

### 5. Don’t auto-start Docker/Colima with the OS

- **Docker Desktop:** Settings → General → uncheck "Start Docker when you sign in" if you don’t need it on every login.
- **Colima:** If you have a launchd/login item that starts Colima at login, disable it when you’re not using the cluster.

After this, use a **non-docker** profile for daily work and reserve the "docker" profile for when you explicitly need it.

---

## API server "not ready" after pgbench / mock data load

This often started after we added **kubeconfig hygiene** (step 2b) which was **overwriting** the active kubeconfig (sometimes Colima's) with a minified copy and breaking reachability.

**Fixes applied (root cause):**

1. **We never overwrite Colima's kubeconfig anymore** — hygiene only slims `~/.kube/config` when you pass `KUBECONFIG=~/.kube/config`. Colima's file at `~/.colima/default/kubernetes/kubeconfig` is never modified.
2. **The pipeline now forces `KUBECONFIG` to Colima's path** (step 2c) before the API server check, so step 3 always uses Colima's config, not a slimmed file.
3. **Ensure script** uses Colima's kubeconfig when `KUBECONFIG` is unset.

**If you already ran the old hygiene and the API server is still not ready:**

- Restore the backup if you had overwritten Colima's config:  
  `cp ~/.kube/config.bak.<timestamp> ~/.kube/config`  
  (Use the backup from when it last worked, or use Colima's path explicitly:  
  `export KUBECONFIG=~/.colima/default/kubernetes/kubeconfig`.)
- Ensure Colima is running: `colima status` → if not, `colima start --with-kubernetes`.
- After heavy pgbench/mock data load, the host or Colima VM can be low on memory; free memory (close other apps, restart Colima) and re-run.
- As a last resort: `SKIP_API_SERVER_CHECK=1 ./scripts/run-preflight-scale-and-all-suites.sh` (continues without step 3).
