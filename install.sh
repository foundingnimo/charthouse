#!/bin/sh
set -eu

CHARTHOUSE_SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CHARTHOUSE_CLAUDE_DIR=${CLAUDE_CONFIG_DIR:-"${HOME}/.claude"}
CHARTHOUSE_RUNTIME_DIR=${CHARTHOUSE_HOME:-"${HOME}/.charthouse"}
CHARTHOUSE_LEGACY_RUNTIME_DIR="${CHARTHOUSE_CLAUDE_DIR}/charthouse"
CHARTHOUSE_CLAUDE_SKILLS_DIR="${CHARTHOUSE_CLAUDE_DIR}/skills"
CHARTHOUSE_SHARED_SKILLS_DIR=${AGENT_SKILLS_DIR:-"${HOME}/.agents/skills"}

if ! command -v node >/dev/null 2>&1; then
  echo "Charthouse requires Node.js 22 or newer; node was not found." >&2
  exit 1
fi
CHARTHOUSE_NODE_MAJOR=$(node -p 'Number.parseInt(process.versions.node.split(".")[0], 10)')
if [ "${CHARTHOUSE_NODE_MAJOR}" -lt 22 ]; then
  echo "Charthouse requires Node.js 22 or newer; found $(node --version)." >&2
  exit 1
fi

CHARTHOUSE_MODE=install
CHARTHOUSE_UNINSTALL=no
CHARTHOUSE_HOST=all
CHARTHOUSE_HOST_SET=no
CHARTHOUSE_HOOKS=yes
CHARTHOUSE_ASSUME_YES=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --update) CHARTHOUSE_MODE=update ;;
    --uninstall) CHARTHOUSE_UNINSTALL=yes ;;
    --host)
      shift
      [ "$#" -gt 0 ] || { echo "--host requires claude, shared or all."; exit 1; }
      CHARTHOUSE_HOST=$1
      CHARTHOUSE_HOST_SET=yes ;;
    --no-hooks) CHARTHOUSE_HOOKS=no ;;
    --yes|-y) CHARTHOUSE_ASSUME_YES=yes ;;
    --help|-h)
      echo "Usage: ./install.sh [--update] [--host claude|shared|all] [--no-hooks] [--yes]"
      echo "       ./install.sh --uninstall [--yes]"
      echo "  --update     Replace an existing installation from this checkout."
      echo "  --host       Install Claude adapters, shared agent adapters, or both (default: all)."
      echo "  --no-hooks   Do not add or refresh Claude lifecycle hooks."
      echo "  --uninstall  Remove the runtime, skills, and Claude hooks. Repositories keep their state."
      echo "  --yes        Answer yes to the update or uninstall prompt."
      exit 0 ;;
    *) echo "Unknown option: $1. Use --help for supported options."; exit 1 ;;
  esac
  shift
done

case "${CHARTHOUSE_HOST}" in
  claude|shared|all) ;;
  *) echo "Unknown host: ${CHARTHOUSE_HOST}. Use claude, shared or all."; exit 1 ;;
esac

if [ "${CHARTHOUSE_UNINSTALL}" = yes ]; then
  if [ "${CHARTHOUSE_MODE}" = update ] || [ "${CHARTHOUSE_HOST_SET}" = yes ] || [ "${CHARTHOUSE_HOOKS}" = no ]; then
    echo "--uninstall removes every adapter. Do not combine it with --update, --host or --no-hooks."
    exit 1
  fi
  if [ "${CHARTHOUSE_ASSUME_YES}" = yes ]; then
    exec node "${CHARTHOUSE_SOURCE_DIR}/scripts/uninstall.mjs" --yes
  fi
  exec node "${CHARTHOUSE_SOURCE_DIR}/scripts/uninstall.mjs"
fi

charthouse_absolute_path() {
  node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$1"
}

CHARTHOUSE_RUNTIME_DIR=$(charthouse_absolute_path "${CHARTHOUSE_RUNTIME_DIR}")
CHARTHOUSE_CLAUDE_DIR=$(charthouse_absolute_path "${CHARTHOUSE_CLAUDE_DIR}")
CHARTHOUSE_SHARED_SKILLS_DIR=$(charthouse_absolute_path "${CHARTHOUSE_SHARED_SKILLS_DIR}")
CHARTHOUSE_LEGACY_RUNTIME_DIR="${CHARTHOUSE_CLAUDE_DIR}/charthouse"
CHARTHOUSE_CLAUDE_SKILLS_DIR="${CHARTHOUSE_CLAUDE_DIR}/skills"
node -e '
  const path = require("path");
  const [runtime, home, source, claude, shared] = process.argv.slice(1).map((item) => path.resolve(item));
  const sameOrAncestor = (parent, child) => parent === child || child.startsWith(parent + path.sep);
  const claudeSkills = path.join(claude, "skills");
  if (runtime === path.parse(runtime).root || sameOrAncestor(runtime, home) || sameOrAncestor(runtime, source)
      || sameOrAncestor(source, runtime) || sameOrAncestor(runtime, claude) || sameOrAncestor(runtime, shared)) {
    process.stderr.write(`Unsafe CHARTHOUSE_HOME: ${runtime}\n`);
    process.exit(1);
  }
  for (const directory of [claudeSkills, shared]) {
    if (directory === path.parse(directory).root || sameOrAncestor(directory, source) || sameOrAncestor(source, directory)) {
      process.stderr.write(`Unsafe skill directory: ${directory}\n`);
      process.exit(1);
    }
  }
' "${CHARTHOUSE_RUNTIME_DIR}" "${HOME}" "${CHARTHOUSE_SOURCE_DIR}" "${CHARTHOUSE_CLAUDE_DIR}" "${CHARTHOUSE_SHARED_SKILLS_DIR}"

# The runtime swap below deletes whatever is at the runtime path. Replace only
# an installed runtime or an empty folder; any other folder can hold user files.
charthouse_runtime_state() {
  node "${CHARTHOUSE_SOURCE_DIR}/scripts/runtime-state.mjs" "$1" 2>/dev/null || echo other
}
CHARTHOUSE_RUNTIME_STATE=$(charthouse_runtime_state "${CHARTHOUSE_RUNTIME_DIR}")
CHARTHOUSE_LEGACY_STATE=$(charthouse_runtime_state "${CHARTHOUSE_LEGACY_RUNTIME_DIR}")
case "${CHARTHOUSE_RUNTIME_STATE}" in
  missing|empty|runtime) ;;
  *)
    echo "${CHARTHOUSE_RUNTIME_DIR} exists and is not a Charthouse runtime. Nothing changed. Set CHARTHOUSE_HOME to another folder or remove this one." >&2
    exit 1 ;;
esac

charthouse_version() {
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$1/package.json" 2>/dev/null || echo unknown
}

charthouse_commit() {
  git -C "$1" rev-parse --short HEAD 2>/dev/null || echo "no commit"
}

charthouse_dirty() {
  if git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
      && [ -n "$(git -C "$1" status --porcelain --untracked-files=normal 2>/dev/null)" ]; then
    echo true
  else
    echo false
  fi
}

charthouse_revision_label() {
  if [ "$2" = true ]; then
    printf '%s-dirty' "$1"
  else
    printf '%s' "$1"
  fi
}

CHARTHOUSE_SOURCE_VERSION=$(charthouse_version "${CHARTHOUSE_SOURCE_DIR}")
CHARTHOUSE_SOURCE_COMMIT=$(charthouse_commit "${CHARTHOUSE_SOURCE_DIR}")
CHARTHOUSE_SOURCE_DIRTY=$(charthouse_dirty "${CHARTHOUSE_SOURCE_DIR}")
CHARTHOUSE_SOURCE_REVISION=$(charthouse_revision_label "${CHARTHOUSE_SOURCE_COMMIT}" "${CHARTHOUSE_SOURCE_DIRTY}")
CHARTHOUSE_CURRENT_RUNTIME=${CHARTHOUSE_RUNTIME_DIR}
if [ "${CHARTHOUSE_RUNTIME_STATE}" != runtime ] && [ "${CHARTHOUSE_LEGACY_STATE}" = runtime ]; then
  CHARTHOUSE_CURRENT_RUNTIME=${CHARTHOUSE_LEGACY_RUNTIME_DIR}
fi

charthouse_installed() {
  [ "${CHARTHOUSE_RUNTIME_STATE}" = runtime ] || [ "${CHARTHOUSE_LEGACY_STATE}" = runtime ] \
    || [ -e "${CHARTHOUSE_CLAUDE_SKILLS_DIR}/charthouse" ] || [ -e "${CHARTHOUSE_CLAUDE_SKILLS_DIR}/charthouse-context" ] \
    || [ -e "${CHARTHOUSE_SHARED_SKILLS_DIR}/charthouse" ] || [ -e "${CHARTHOUSE_SHARED_SKILLS_DIR}/charthouse-context" ]
}

if charthouse_installed; then
  CHARTHOUSE_INSTALLED_VERSION=$(charthouse_version "${CHARTHOUSE_CURRENT_RUNTIME}")
  CHARTHOUSE_INSTALLED_REVISION=$(node -e 'try { const stamp=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const commit=stamp.commit || "unknown commit"; process.stdout.write(stamp.dirty === true ? `${commit}-dirty` : commit); } catch { process.stdout.write("unknown commit"); }' "${CHARTHOUSE_CURRENT_RUNTIME}/.install.json" 2>/dev/null || echo "unknown commit")
  echo "Charthouse ${CHARTHOUSE_INSTALLED_VERSION} (${CHARTHOUSE_INSTALLED_REVISION}) is installed in ${CHARTHOUSE_CURRENT_RUNTIME}."
  echo "This checkout is ${CHARTHOUSE_SOURCE_VERSION} (${CHARTHOUSE_SOURCE_REVISION})."
  if [ "${CHARTHOUSE_MODE}" != update ]; then
    if [ "${CHARTHOUSE_ASSUME_YES}" = yes ]; then
      CHARTHOUSE_MODE=update
    elif [ -t 0 ]; then
      printf 'Update the installation from this checkout? [Y/n] '
      read -r CHARTHOUSE_ANSWER
      case "${CHARTHOUSE_ANSWER}" in
        ""|y|Y|yes|YES) CHARTHOUSE_MODE=update ;;
        *) echo "Nothing changed."; exit 0 ;;
      esac
    else
      echo "Run ./install.sh --update to replace it from this checkout, or use plugin mode."
      exit 1
    fi
  fi
elif [ "${CHARTHOUSE_MODE}" = update ]; then
  echo "Charthouse is not installed. Run ./install.sh without --update."
  exit 1
fi

# Stage the provider-neutral runtime before replacing the live copy.
CHARTHOUSE_STAGE_DIR="${CHARTHOUSE_RUNTIME_DIR}.install-$$"
rm -rf "${CHARTHOUSE_STAGE_DIR}"
mkdir -p "${CHARTHOUSE_STAGE_DIR}"
for CHARTHOUSE_PART in .claude-plugin agents bin docs hooks schemas scripts skills templates; do
  cp -R "${CHARTHOUSE_SOURCE_DIR}/${CHARTHOUSE_PART}" "${CHARTHOUSE_STAGE_DIR}/${CHARTHOUSE_PART}"
done
cp "${CHARTHOUSE_SOURCE_DIR}/package.json" "${CHARTHOUSE_STAGE_DIR}/package.json"
cp "${CHARTHOUSE_SOURCE_DIR}/LICENSE" "${CHARTHOUSE_STAGE_DIR}/LICENSE"
chmod +x "${CHARTHOUSE_STAGE_DIR}/bin/charthouse"

case "${CHARTHOUSE_HOST}" in
  claude) CHARTHOUSE_HOSTS_JSON='["claude"]' ;;
  shared) CHARTHOUSE_HOSTS_JSON='["shared"]' ;;
  all) CHARTHOUSE_HOSTS_JSON='["claude","shared"]' ;;
esac
CHARTHOUSE_STAMP_HOOKS=false
if [ "${CHARTHOUSE_HOOKS}" = yes ] && { [ "${CHARTHOUSE_HOST}" = claude ] || [ "${CHARTHOUSE_HOST}" = all ]; }; then
  CHARTHOUSE_STAMP_HOOKS=true
fi
node -e 'const fs=require("fs"); const [path,version,commit,dirty,source,runtime,hosts,hooks]=process.argv.slice(1); fs.writeFileSync(path, JSON.stringify({version,commit,dirty:dirty==="true",source,runtime,hosts:JSON.parse(hosts),hooks:hooks==="true",installed_at:new Date().toISOString()},null,2)+"\n")' \
  "${CHARTHOUSE_STAGE_DIR}/.install.json" "${CHARTHOUSE_SOURCE_VERSION}" "${CHARTHOUSE_SOURCE_COMMIT}" "${CHARTHOUSE_SOURCE_DIRTY}" "${CHARTHOUSE_SOURCE_DIR}" "${CHARTHOUSE_RUNTIME_DIR}" "${CHARTHOUSE_HOSTS_JSON}" "${CHARTHOUSE_STAMP_HOOKS}"

mkdir -p "$(dirname -- "${CHARTHOUSE_RUNTIME_DIR}")"
CHARTHOUSE_BACKUP_DIR="${CHARTHOUSE_RUNTIME_DIR}.previous-$$"
rm -rf "${CHARTHOUSE_BACKUP_DIR}"
if [ -e "${CHARTHOUSE_RUNTIME_DIR}" ]; then mv "${CHARTHOUSE_RUNTIME_DIR}" "${CHARTHOUSE_BACKUP_DIR}"; fi
if mv "${CHARTHOUSE_STAGE_DIR}" "${CHARTHOUSE_RUNTIME_DIR}"; then
  rm -rf "${CHARTHOUSE_BACKUP_DIR}"
else
  if [ -e "${CHARTHOUSE_BACKUP_DIR}" ]; then mv "${CHARTHOUSE_BACKUP_DIR}" "${CHARTHOUSE_RUNTIME_DIR}"; fi
  echo "Charthouse could not replace the runtime; the previous installation was restored."
  exit 1
fi
if [ "${CHARTHOUSE_HOST}" != shared ] && [ "${CHARTHOUSE_LEGACY_RUNTIME_DIR}" != "${CHARTHOUSE_RUNTIME_DIR}" ]; then
  case "${CHARTHOUSE_LEGACY_STATE}" in
    runtime) rm -rf "${CHARTHOUSE_LEGACY_RUNTIME_DIR}" ;;
    other) echo "Kept ${CHARTHOUSE_LEGACY_RUNTIME_DIR}: it is not a Charthouse runtime." ;;
  esac
fi

charthouse_install_skill_pair() {
  CHARTHOUSE_DESTINATION=$1
  mkdir -p "${CHARTHOUSE_DESTINATION}"
  rm -rf "${CHARTHOUSE_DESTINATION}/charthouse" "${CHARTHOUSE_DESTINATION}/charthouse-context"
  cp -R "${CHARTHOUSE_SOURCE_DIR}/skills/charthouse" "${CHARTHOUSE_DESTINATION}/charthouse"
  cp -R "${CHARTHOUSE_SOURCE_DIR}/skills/charthouse-context" "${CHARTHOUSE_DESTINATION}/charthouse-context"
}

case "${CHARTHOUSE_HOST}" in
  claude) charthouse_install_skill_pair "${CHARTHOUSE_CLAUDE_SKILLS_DIR}" ;;
  shared) charthouse_install_skill_pair "${CHARTHOUSE_SHARED_SKILLS_DIR}" ;;
  all)
    charthouse_install_skill_pair "${CHARTHOUSE_CLAUDE_SKILLS_DIR}"
    charthouse_install_skill_pair "${CHARTHOUSE_SHARED_SKILLS_DIR}" ;;
esac

if [ "${CHARTHOUSE_HOOKS}" = yes ] && { [ "${CHARTHOUSE_HOST}" = claude ] || [ "${CHARTHOUSE_HOST}" = all ]; }; then
  node "${CHARTHOUSE_RUNTIME_DIR}/scripts/install-standalone-hooks.mjs" "${CHARTHOUSE_CLAUDE_DIR}" "${CHARTHOUSE_RUNTIME_DIR}"
fi

if [ "${CHARTHOUSE_MODE}" = update ]; then
  echo "Updated Charthouse to ${CHARTHOUSE_SOURCE_VERSION} (${CHARTHOUSE_SOURCE_REVISION}) for ${CHARTHOUSE_HOST}. Restart open coding-agent sessions."
else
  echo "Installed Charthouse ${CHARTHOUSE_SOURCE_VERSION} (${CHARTHOUSE_SOURCE_REVISION}) for ${CHARTHOUSE_HOST}. Restart open coding-agent sessions."
fi
if [ "${CHARTHOUSE_HOOKS}" = no ] && { [ "${CHARTHOUSE_HOST}" = claude ] || [ "${CHARTHOUSE_HOST}" = all ]; }; then
  echo "Claude hooks were not installed. Charthouse remains available on demand."
fi
