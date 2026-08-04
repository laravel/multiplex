#!/bin/bash
set -euo pipefail

REPO="laravel/multiplex"
BRANCH="main"

# Ensure we are on correct branch and the working tree is clean
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "Error: must be on $BRANCH branch (current: $CURRENT_BRANCH)" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes before releasing." >&2
  git status --porcelain
  exit 1
fi

get_current_version() {
    if [ -f "package.json" ]; then
        grep '"version":' package.json | cut -d\" -f4
    else
        echo "Error: package.json not found"
        exit 1
    fi
}

git pull

CURRENT_VERSION=$(get_current_version)
echo ""
echo "Current version: $CURRENT_VERSION"
echo ""

echo "Select version bump type:"
echo "1) patch (bug fixes)"
echo "2) minor (new features)"
echo "3) major (breaking changes)"
echo

read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        RELEASE_TYPE="patch"
        ;;
    2)
        RELEASE_TYPE="minor"
        ;;
    3)
        RELEASE_TYPE="major"
        ;;
    *)
        echo "❌ Invalid choice. Exiting."
        exit 1
        ;;
esac

pnpm version "$RELEASE_TYPE" --no-git-tag-version

NEW_VERSION=$(get_current_version)
TAG="v$NEW_VERSION"

# Sync version into CLI
sed -i '' "s/\.version(\".*\")/\.version(\"$NEW_VERSION\")/" src/cli.tsx

echo "Updating lock file..."
pnpm i
echo ""

echo "Staging changes..."
git add package.json pnpm-lock.yaml src/cli.tsx
echo ""

git commit -m "$TAG"
git tag -a "$TAG" -m "$TAG"
git push
git push --tags

gh release create "$TAG" --generate-notes

echo ""
echo "✅ Release $TAG completed successfully, publishing kicked off in CI."
echo "🔗 https://github.com/$REPO/releases/tag/$TAG"
