#!/usr/bin/env bash
# Helper script to set up Docker alias for Colima nerdctl
# This allows using 'docker' command when Colima is using containerd runtime

# Check if Colima is running with containerd
if ! colima status >/dev/null 2>&1; then
    echo "❌ Colima is not running"
    echo "Start Colima first: colima start --runtime containerd"
    exit 1
fi

# Check runtime
RUNTIME=$(colima status 2>/dev/null | grep -i runtime | awk '{print $2}' || echo "")
if [[ "$RUNTIME" != "containerd" ]]; then
    echo "⚠️  Colima is not using containerd runtime (current: ${RUNTIME:-unknown})"
    echo "This alias is only needed for containerd runtime"
    exit 0
fi

echo "Setting up Docker alias for Colima nerdctl..."
echo ""
echo "Add this to your ~/.zshrc or ~/.bashrc:"
echo ""
echo "  # Colima nerdctl alias (for containerd runtime)"
echo "  alias docker='colima nerdctl'"
echo "  export DOCKER_HOST=\"unix://\${HOME}/.colima/default/nerdctl.sock\""
echo ""
echo "Or run this command to add it automatically:"
echo ""
echo "  echo \"alias docker='colima nerdctl'\" >> ~/.zshrc"
echo "  source ~/.zshrc"
echo ""
read -p "Add alias to ~/.zshrc now? (y/n): " add_alias

if [[ "$add_alias" == "y" ]]; then
    # Add alias to ~/.zshrc
    if ! grep -q "alias docker='colima nerdctl'" ~/.zshrc 2>/dev/null; then
        echo "" >> ~/.zshrc
        echo "# Colima nerdctl alias (for containerd runtime)" >> ~/.zshrc
        echo "alias docker='colima nerdctl'" >> ~/.zshrc
        echo "✅ Alias added to ~/.zshrc"
        echo "Run: source ~/.zshrc (or restart terminal)"
    else
        echo "✅ Alias already exists in ~/.zshrc"
    fi
    
    # Also add to ~/.bashrc if it exists
    if [[ -f ~/.bashrc ]] && ! grep -q "alias docker='colima nerdctl'" ~/.bashrc 2>/dev/null; then
        echo "" >> ~/.bashrc
        echo "# Colima nerdctl alias (for containerd runtime)" >> ~/.bashrc
        echo "alias docker='colima nerdctl'" >> ~/.bashrc
        echo "✅ Alias added to ~/.bashrc"
    fi
else
    echo "Skipped. You can add the alias manually later."
fi

echo ""
echo "After adding the alias, you can use 'docker' commands normally:"
echo "  docker ps          # List containers"
echo "  docker images      # List images"
echo "  docker build       # Build images"
echo ""
echo "Note: The alias maps 'docker' to 'colima nerdctl' for containerd runtime"
