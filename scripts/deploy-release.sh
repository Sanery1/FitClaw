#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly SCRIPT_NAME="${0##*/}"
readonly DEFAULT_HOME_ROOT="/home/ubuntu"
readonly SOCKET_VOLUME="fitclaw_skill-runner-socket"

usage() {
	cat <<EOF
Usage:
  $SCRIPT_NAME <40-character-lowercase-git-sha>
  $SCRIPT_NAME verify <40-character-lowercase-git-sha>

Deploys one ordinary, storage-compatible FitClaw release on the single-server
Docker Compose installation. First installs, data migrations, incompatible
storage changes, and rollback decisions remain manual procedures documented in
docs/DEPLOYMENT_ARCHITECTURE.md.

Optional environment overrides:
  FITCLAW_DEPLOY_HOME_ROOT     Server home root (default: $DEFAULT_HOME_ROOT)
  FITCLAW_DEPLOY_APP           Current release path (default: <home>/fitclaw)
  FITCLAW_DEPLOY_REPO_URL      Git remote used for the candidate checkout
EOF
}

log() {
	printf '[fitclaw-deploy] %s\n' "$*"
}

die() {
	printf '[fitclaw-deploy] ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

is_valid_sha() {
	[[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

readonly DEPLOY_STATE_LIB="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/deploy-release-state.sh"
[[ -f "$DEPLOY_STATE_LIB" && ! -L "$DEPLOY_STATE_LIB" ]] || die "Deployment state library is missing or is a symbolic link: $DEPLOY_STATE_LIB"
# shellcheck disable=SC1090
source "$DEPLOY_STATE_LIB"

current_compose() {
	docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" "$@"
}

candidate_compose() {
	docker compose \
		--project-name "$CANDIDATE_PROJECT" \
		--project-directory "$STAGE" \
		--file "$STAGE/docker-compose.yml" \
		"$@"
}

validate_container_bindings() {
	local workspace_source project_label service_label bot_workspace runner_workspace bot_socket runner_socket
	workspace_source="$(readlink -f -- "$APP/feishu-workspace")" || return 1

	project_label="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' fitclaw-bot 2>/dev/null)" || return 1
	[[ "$project_label" == "fitclaw" ]] || return 1
	project_label="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' fitclaw-skill-runner 2>/dev/null)" || return 1
	[[ "$project_label" == "fitclaw" ]] || return 1
	service_label="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' fitclaw-bot 2>/dev/null)" || return 1
	[[ "$service_label" == "fitclaw-bot" ]] || return 1
	service_label="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' fitclaw-skill-runner 2>/dev/null)" || return 1
	[[ "$service_label" == "fitclaw-skill-runner" ]] || return 1

	bot_workspace="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/opt/fitclaw/feishu-workspace"}}{{printf "%s|%s|%t" .Type .Source .RW}}{{end}}{{end}}' fitclaw-bot 2>/dev/null)" || return 1
	runner_workspace="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/opt/fitclaw/feishu-workspace"}}{{printf "%s|%s|%t" .Type .Source .RW}}{{end}}{{end}}' fitclaw-skill-runner 2>/dev/null)" || return 1
	[[ "$bot_workspace" == "bind|$workspace_source|true" ]] || return 1
	[[ "$runner_workspace" == "bind|$workspace_source|false" ]] || return 1

	bot_socket="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/run/fitclaw-skill-runner"}}{{printf "%s|%s|%t" .Type .Name .RW}}{{end}}{{end}}' fitclaw-bot 2>/dev/null)" || return 1
	runner_socket="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/run/fitclaw-skill-runner"}}{{printf "%s|%s|%t" .Type .Name .RW}}{{end}}{{end}}' fitclaw-skill-runner 2>/dev/null)" || return 1
	[[ "$bot_socket" == "volume|$SOCKET_VOLUME|true" ]] || return 1
	[[ "$runner_socket" == "volume|$SOCKET_VOLUME|true" ]] || return 1
}

git_sha_if_present() {
	local directory="$1"
	if [[ -d "$directory/.git" ]]; then
		git -C "$directory" rev-parse --verify HEAD 2>/dev/null || true
	fi
}

workspace_stats() {
	local directory="$1"
	local files bytes
	files="$(sudo find "$directory" -type f -printf '.' | wc -c)"
	bytes="$(sudo find "$directory" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
	printf '%s %s\n' "$files" "$bytes"
}

workspace_manifest() {
	local directory="$1"
	local output="$2"
	local temporary_output="$output.tmp.$$"
	if ! sudo bash -euo pipefail -c '
		cd "$1"
		find . -type f -print0 | sort -z | xargs -0 -r sha256sum
		find . -printf "metadata %y %m %U %G %p -> %l\n" | sort
	' _ "$directory" >"$temporary_output"; then
		rm -f -- "$temporary_output"
		return 1
	fi
	chmod 600 "$temporary_output" || return 1
	mv -- "$temporary_output" "$output" || return 1
	sync -f "$output"
}

manifest_matches() {
	local directory="$1"
	local expected_manifest="$2"
	local actual_manifest
	[[ -f "$expected_manifest" ]] || return 1
	actual_manifest="$(mktemp "$RELEASE_RECORD_DIR/.workspace-check.XXXXXX")"
	if ! workspace_manifest "$directory" "$actual_manifest"; then
		rm -f -- "$actual_manifest"
		return 1
	fi
	if ! cmp --silent "$expected_manifest" "$actual_manifest"; then
		rm -f -- "$actual_manifest"
		return 1
	fi
	rm -f -- "$actual_manifest"
}

assert_safe_release_path() {
	local path="$1"
	case "$path" in
		"$STAGE" | "$STAGE"/* | "$BACKUP" | "$BACKUP"/*) ;;
		*) die "Refusing to modify a path outside this release: $path" ;;
	esac
}

remove_release_path() {
	local path="$1"
	assert_safe_release_path "$path"
	sudo rm -rf -- "$path"
}

sudo_path_exists_or_link() {
	local path="$1"
	sudo test -e "$path" || sudo test -L "$path"
}

socket_for_image() {
	local image="$1"
	local uid="$2"
	local gid="$3"
	docker volume inspect "$SOCKET_VOLUME" >/dev/null
	docker run --rm --user 0:0 --entrypoint rm \
		--volume "$SOCKET_VOLUME:/run/fitclaw-skill-runner" \
		"$image" -f /run/fitclaw-skill-runner/runner.sock
	docker run --rm --user 0:0 --entrypoint chown \
		--volume "$SOCKET_VOLUME:/run/fitclaw-skill-runner" \
		"$image" -R "$uid:$gid" /run/fitclaw-skill-runner
}

validate_recorded_release_metadata() {
	is_valid_sha "$OLD_RELEASE_SHA" || die "Release record has no valid old Git SHA"
	[[ "$NEW_BOT_IMAGE" == sha256:* && "$NEW_RUNNER_IMAGE" == sha256:* ]] || die "Release record has invalid candidate image IDs"
	[[ "$OLD_BOT_IMAGE" == sha256:* && "$OLD_RUNNER_IMAGE" == sha256:* ]] || die "Release record has invalid old image IDs"
	[[ "$NEW_UID" =~ ^[0-9]+$ && "$NEW_GID" =~ ^[0-9]+$ ]] || die "Release record has invalid candidate UID/GID"
	[[ "$OLD_UID" =~ ^[0-9]+$ && "$OLD_GID" =~ ^[0-9]+$ ]] || die "Release record has invalid old UID/GID"
	[[ -n "$OLD_BOT_REF" && -n "$OLD_RUNNER_REF" ]] || die "Release record has no old image references"
	docker image inspect "$NEW_BOT_IMAGE" "$NEW_RUNNER_IMAGE" "$OLD_BOT_IMAGE" "$OLD_RUNNER_IMAGE" >/dev/null
}

validate_candidate_checkout() {
	[[ -d "$STAGE/.git" && ! -L "$STAGE" ]] || die "Candidate checkout is missing or is a symbolic link: $STAGE"
	[[ "$(git -C "$STAGE" rev-parse --verify HEAD)" == "$RELEASE_SHA" ]] || die "Candidate checkout does not match the requested SHA"
	[[ "$(git -C "$STAGE" remote get-url origin)" == "$REPO_URL" ]] || die "Candidate checkout origin differs from the release record"
	[[ -z "$(git -C "$STAGE" status --porcelain --untracked-files=all)" ]] || die "Candidate checkout has tracked or untracked changes"

	local ignored_path
	while IFS= read -r ignored_path; do
		case "$ignored_path" in
			.env | feishu-workspace/) ;;
			*) die "Candidate checkout contains an unexpected ignored path: $ignored_path" ;;
		esac
	done < <(git -C "$STAGE" ls-files --others --ignored --exclude-standard --directory)
}

clean_candidate_scratch() {
	local relative_path absolute_path
	for relative_path in feishu-workspace.copying .fitclaw-deploy-skill-sync; do
		if git -C "$STAGE" ls-files --error-unmatch -- "$relative_path" >/dev/null 2>&1; then
			die "Reserved deployment scratch path is tracked by the candidate: $relative_path"
		fi
		absolute_path="$STAGE/$relative_path"
		if [[ -e "$absolute_path" || -L "$absolute_path" ]]; then
			remove_release_path "$absolute_path"
		fi
	done
}

write_rollback_images() {
	local rollback_file="$APP/.rollback-images"
	local temporary_file="$APP/.rollback-images.tmp.$$"
	{
		printf 'OLD_BOT_REF=%q\n' "$OLD_BOT_REF"
		printf 'OLD_BOT_IMAGE=%q\n' "$OLD_BOT_IMAGE"
		printf 'OLD_RUNNER_REF=%q\n' "$OLD_RUNNER_REF"
		printf 'OLD_RUNNER_IMAGE=%q\n' "$OLD_RUNNER_IMAGE"
		printf 'OLD_UID=%q\n' "$OLD_UID"
		printf 'OLD_GID=%q\n' "$OLD_GID"
	} >"$temporary_file"
	chmod 600 "$temporary_file"
	mv -- "$temporary_file" "$rollback_file"
	sync -f "$rollback_file"
}

preflight_current_release() {
	[[ "$(dirname -- "$APP")" == "$HOME_ROOT" ]] || die "The app must be a direct child of the configured home root"
	[[ -d "$APP/.git" && ! -L "$APP" ]] || die "Current app checkout is missing or is a symbolic link: $APP"
	[[ -f "$APP/.env" && ! -L "$APP/.env" ]] || die "Current .env is missing or is a symbolic link"
	[[ "$(stat -c '%a' "$APP/.env")" == "600" ]] || die "Current .env mode must be 0600"
	[[ -d "$APP/feishu-workspace" && ! -L "$APP/feishu-workspace" ]] || die "Current workspace is missing or is a symbolic link"
	[[ -z "$(git -C "$APP" status --porcelain --untracked-files=no)" ]] || die "Current release has tracked working-tree changes"
	sudo systemctl is-active --quiet docker || die "Docker service is not active"
	docker info >/dev/null
	docker compose version >/dev/null
	docker inspect fitclaw-bot fitclaw-skill-runner >/dev/null
	validate_container_bindings || die "Current containers do not match the fitclaw project, workspace mount, or socket-volume contract"
	if [[ -n "$OLD_RELEASE_SHA" ]]; then
		[[ "$(git -C "$APP" rev-parse --verify HEAD)" == "$OLD_RELEASE_SHA" ]] || die "Current app no longer matches the recorded old release"
		[[ "$(docker inspect --format '{{.Image}}' fitclaw-bot)" == "$OLD_BOT_IMAGE" ]] || die "Current Bot image no longer matches the release record"
		[[ "$(docker inspect --format '{{.Image}}' fitclaw-skill-runner)" == "$OLD_RUNNER_IMAGE" ]] || die "Current Runner image no longer matches the release record"
	fi
}

ensure_candidate_checkout() {
	if [[ -L "$STAGE" ]]; then
		die "Candidate path cannot be a symbolic link: $STAGE"
	elif [[ ! -e "$STAGE" ]]; then
		mkdir -- "$STAGE"
		git -C "$STAGE" init --quiet
		git -C "$STAGE" remote add origin "$REPO_URL"
	elif [[ ! -d "$STAGE/.git" ]]; then
		[[ -d "$STAGE" && -z "$(find "$STAGE" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "Candidate path exists but is not an empty directory or Git checkout: $STAGE"
		git -C "$STAGE" init --quiet
		git -C "$STAGE" remote add origin "$REPO_URL"
	fi

	local configured_remote
	configured_remote="$(git -C "$STAGE" remote get-url origin 2>/dev/null || true)"
	if [[ -z "$configured_remote" ]]; then
		git -C "$STAGE" remote add origin "$REPO_URL"
	elif [[ "$configured_remote" != "$REPO_URL" ]]; then
		die "Candidate checkout origin differs from the release record"
	fi

	if [[ "$(git_sha_if_present "$STAGE")" != "$RELEASE_SHA" ]]; then
		[[ -z "$(git -C "$STAGE" status --porcelain --untracked-files=all 2>/dev/null || true)" ]] || die "Candidate checkout has tracked or untracked changes"
		git -C "$STAGE" fetch --no-tags origin "$RELEASE_SHA"
		git -C "$STAGE" checkout --detach "$RELEASE_SHA"
	fi
	install -m 600 "$APP/.env" "$STAGE/.env"
	validate_candidate_checkout
	candidate_compose config --quiet
}

prepare_release() {
	log "Preparing candidate $RELEASE_SHA"
	ensure_candidate_checkout
	candidate_compose build

	local candidate_bot_ref="${CANDIDATE_PROJECT}-fitclaw-bot"
	local candidate_runner_ref="${CANDIDATE_PROJECT}-fitclaw-skill-runner"
	NEW_BOT_IMAGE="$(docker image inspect --format '{{.Id}}' "$candidate_bot_ref")"
	NEW_RUNNER_IMAGE="$(docker image inspect --format '{{.Id}}' "$candidate_runner_ref")"
	[[ "$NEW_BOT_IMAGE" == sha256:* && "$NEW_RUNNER_IMAGE" == sha256:* ]] || die "Candidate image lookup failed"
	NEW_UID="$(docker run --rm --entrypoint id "$NEW_BOT_IMAGE" -u fitclaw)"
	NEW_GID="$(docker run --rm --entrypoint id "$NEW_BOT_IMAGE" -g fitclaw)"

	OLD_BOT_REF="$(docker inspect --format '{{.Config.Image}}' fitclaw-bot)"
	OLD_BOT_IMAGE="$(docker inspect --format '{{.Image}}' fitclaw-bot)"
	OLD_RUNNER_REF="$(docker inspect --format '{{.Config.Image}}' fitclaw-skill-runner)"
	OLD_RUNNER_IMAGE="$(docker inspect --format '{{.Image}}' fitclaw-skill-runner)"
	OLD_RELEASE_SHA="$(git -C "$APP" rev-parse --verify HEAD)"
	OLD_UID="$(docker run --rm --entrypoint id "$OLD_BOT_IMAGE" -u fitclaw)"
	OLD_GID="$(docker run --rm --entrypoint id "$OLD_BOT_IMAGE" -g fitclaw)"
	preflight_current_release
	validate_recorded_release_metadata
	write_rollback_images
	set_status prepared
}

validate_skill_transition() {
	[[ -d "$APP/.fitclaw/skills" && -d "$STAGE/.fitclaw/skills" ]] || die "Canonical Skill directories are missing"
	local source skill_name runtime_target
	for source in "$APP"/.fitclaw/skills/*; do
		[[ -f "$source/SKILL.md" ]] || continue
		skill_name="${source##*/}"
		[[ -f "$STAGE/.fitclaw/skills/$skill_name/SKILL.md" ]] || die "Canonical Skill was deleted or renamed and needs manual retirement: $skill_name"
	done
	for source in "$STAGE"/.fitclaw/skills/*; do
		[[ -f "$source/SKILL.md" ]] || continue
		skill_name="${source##*/}"
		[[ "$skill_name" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid canonical Skill directory name: $skill_name"
		runtime_target="$APP/feishu-workspace/skills/$skill_name"
		if sudo test -e "$runtime_target" || sudo test -L "$runtime_target"; then
			[[ -f "$APP/.fitclaw/skills/$skill_name/SKILL.md" ]] || die "New canonical Skill collides with a workspace-only Skill: $skill_name"
		fi
	done
}

copy_workspace() {
	clean_candidate_scratch
	validate_candidate_checkout
	validate_skill_transition
	log "Stopping Bot and copying the frozen workspace"
	BOT_STOPPED_BY_SCRIPT=true
	current_compose stop fitclaw-bot
	set_status bot_stopped

	local copy_path="$STAGE/feishu-workspace.copying"
	assert_safe_release_path "$copy_path"
	if [[ -e "$copy_path" || -L "$copy_path" ]]; then
		remove_release_path "$copy_path"
	fi
	sudo cp -a -- "$APP/feishu-workspace" "$copy_path"

	SOURCE_STATS="$(workspace_stats "$APP/feishu-workspace")"
	local target_stats
	target_stats="$(workspace_stats "$copy_path")"
	SOURCE_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-source.sha256"
	TARGET_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-copy.sha256"
	workspace_manifest "$APP/feishu-workspace" "$SOURCE_MANIFEST"
	workspace_manifest "$copy_path" "$TARGET_MANIFEST"
	[[ "$SOURCE_STATS" == "$target_stats" ]] || die "Workspace file count or byte size changed during copy"
	cmp --silent "$SOURCE_MANIFEST" "$TARGET_MANIFEST" || die "Workspace content or metadata changed during copy"

	if [[ -e "$STAGE/feishu-workspace" || -L "$STAGE/feishu-workspace" ]]; then
		remove_release_path "$STAGE/feishu-workspace"
	fi
	sudo mv -- "$copy_path" "$STAGE/feishu-workspace"
	sudo sync -f "$STAGE/feishu-workspace"
	set_status workspace_copied
}

sync_canonical_skills() {
	clean_candidate_scratch
	validate_candidate_checkout
	log "Synchronizing canonical Skills into the candidate workspace"
	if sudo test -L "$STAGE/feishu-workspace/skills"; then
		die "Candidate workspace Skills path cannot be a symbolic link"
	fi
	sudo mkdir -p -- "$STAGE/feishu-workspace/skills"

	local scratch_path="$STAGE/.fitclaw-deploy-skill-sync"
	mkdir -- "$scratch_path"
	local source skill_name target temporary_target
	for source in "$STAGE"/.fitclaw/skills/*; do
		[[ -f "$source/SKILL.md" ]] || continue
		skill_name="${source##*/}"
		[[ "$skill_name" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid canonical Skill directory name: $skill_name"
		target="$STAGE/feishu-workspace/skills/$skill_name"
		temporary_target="$scratch_path/$skill_name"
		assert_safe_release_path "$target"
		sudo cp -a -- "$source" "$temporary_target"
		if sudo_path_exists_or_link "$target"; then
			remove_release_path "$target"
		fi
		sudo mv -- "$temporary_target" "$target"
	done
	remove_release_path "$scratch_path"

	sudo chown -R "$NEW_UID:$NEW_GID" "$STAGE/feishu-workspace"
	sudo chmod 750 "$STAGE/feishu-workspace"
	RUNTIME_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-runtime.sha256"
	workspace_manifest "$STAGE/feishu-workspace" "$RUNTIME_MANIFEST"
	CUTOVER_MANIFEST="$RUNTIME_MANIFEST"
	sudo sync -f "$STAGE/feishu-workspace"
	set_status skills_synced
}

restore_old_runtime() {
	log "Restoring the old runtime before retrying the release"
	local app_sha stage_sha backup_sha
	app_sha="$(git_sha_if_present "$APP")"
	stage_sha="$(git_sha_if_present "$STAGE")"
	backup_sha="$(git_sha_if_present "$BACKUP")"

	if [[ "$app_sha" == "$OLD_RELEASE_SHA" && "$stage_sha" == "$RELEASE_SHA" && ! -e "$BACKUP" ]]; then
		:
	elif [[ ! -e "$APP" && "$stage_sha" == "$RELEASE_SHA" && "$backup_sha" == "$OLD_RELEASE_SHA" ]]; then
		mv -- "$BACKUP" "$APP" || return 1
	elif [[ "$app_sha" == "$RELEASE_SHA" && ! -e "$STAGE" && "$backup_sha" == "$OLD_RELEASE_SHA" ]]; then
		mv -- "$APP" "$STAGE" || return 1
		mv -- "$BACKUP" "$APP" || return 1
	else
		printf '[fitclaw-deploy] Directory state is ambiguous; preserve APP/STAGE/BACKUP and follow deployment guide section 10.\n' >&2
		return 1
	fi

	docker tag "$OLD_BOT_IMAGE" "$OLD_BOT_REF" || return 1
	docker tag "$OLD_RUNNER_IMAGE" "$OLD_RUNNER_REF" || return 1
	current_compose stop fitclaw-skill-runner >/dev/null 2>&1 || return 1
	socket_for_image "$OLD_RUNNER_IMAGE" "$OLD_UID" "$OLD_GID" || return 1
	current_compose up -d --force-recreate --no-build || return 1
	[[ "$(docker inspect --format '{{.Image}}' fitclaw-bot 2>/dev/null)" == "$OLD_BOT_IMAGE" ]] || return 1
	[[ "$(docker inspect --format '{{.Image}}' fitclaw-skill-runner 2>/dev/null)" == "$OLD_RUNNER_IMAGE" ]] || return 1
	[[ "$(docker inspect --format '{{.State.Running}}' fitclaw-bot 2>/dev/null)" == "true" ]] || return 1
	BOT_STOPPED_BY_SCRIPT=false
	CUTOVER_STARTED_BY_SCRIPT=false
	set_status prepared || return 1
}

has_recoverable_pre_start_layout() {
	local app_sha stage_sha backup_sha
	app_sha="$(git_sha_if_present "$APP")"
	stage_sha="$(git_sha_if_present "$STAGE")"
	backup_sha="$(git_sha_if_present "$BACKUP")"
	if [[ "$app_sha" == "$OLD_RELEASE_SHA" && "$stage_sha" == "$RELEASE_SHA" && ! -e "$BACKUP" ]]; then
		return 0
	fi
	if [[ ! -e "$APP" && "$stage_sha" == "$RELEASE_SHA" && "$backup_sha" == "$OLD_RELEASE_SHA" ]]; then
		return 0
	fi
	if [[ "$app_sha" == "$RELEASE_SHA" && ! -e "$STAGE" && "$backup_sha" == "$OLD_RELEASE_SHA" ]]; then
		return 0
	fi
	return 1
}

record_pre_start_recovery_failure() {
	if has_recoverable_pre_start_layout; then
		STATUS="cutover_started"
		printf '[fitclaw-deploy] Old runtime recovery is incomplete but remains safely retryable with the same command.\n' >&2
	else
		STATUS="recovery_required"
		printf '[fitclaw-deploy] Directory state is ambiguous; follow deployment guide section 10.\n' >&2
	fi
	write_record || true
}

perform_cutover() {
	validate_recorded_release_metadata
	clean_candidate_scratch
	validate_candidate_checkout
	manifest_matches "$APP/feishu-workspace" "$SOURCE_MANIFEST" || die "Frozen source workspace no longer matches its recorded manifest"
	manifest_matches "$STAGE/feishu-workspace" "$CUTOVER_MANIFEST" || die "Candidate workspace no longer matches the recorded cutover manifest"
	[[ "$(git_sha_if_present "$APP")" == "$OLD_RELEASE_SHA" ]] || die "Current directory does not contain the recorded old release"
	[[ "$(git_sha_if_present "$STAGE")" == "$RELEASE_SHA" ]] || die "Candidate directory does not contain the requested release"
	[[ ! -e "$BACKUP" ]] || die "Backup path already exists: $BACKUP"

	log "Switching release directories"
	CUTOVER_STARTED_BY_SCRIPT=true
	set_status cutover_started
	current_compose stop fitclaw-skill-runner
	socket_for_image "$NEW_RUNNER_IMAGE" "$NEW_UID" "$NEW_GID"
	mv -- "$APP" "$BACKUP"
	set_status app_moved
	mv -- "$STAGE" "$APP"
	set_status directories_swapped

	docker tag "$NEW_BOT_IMAGE" "$OLD_BOT_REF"
	docker tag "$NEW_RUNNER_IMAGE" "$OLD_RUNNER_REF"
	set_status starting
	START_ATTEMPTED=true
	current_compose up -d --force-recreate --no-build
	verify_running_release
	DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	set_status containers_started
	BOT_STOPPED_BY_SCRIPT=false
	CUTOVER_STARTED_BY_SCRIPT=false
	START_ATTEMPTED=false
}

verify_running_release() {
	[[ "$(git_sha_if_present "$APP")" == "$RELEASE_SHA" ]] || return 1
	[[ "$(docker inspect --format '{{.Image}}' fitclaw-bot 2>/dev/null)" == "$NEW_BOT_IMAGE" ]] || return 1
	[[ "$(docker inspect --format '{{.Image}}' fitclaw-skill-runner 2>/dev/null)" == "$NEW_RUNNER_IMAGE" ]] || return 1
	validate_container_bindings || return 1

	local runner_health=""
	local attempt
	for attempt in {1..30}; do
		runner_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' fitclaw-skill-runner 2>/dev/null || true)"
		[[ "$runner_health" == "healthy" ]] && break
		sleep 2
	done
	[[ "$runner_health" == "healthy" ]] || return 1
	[[ "$(docker inspect --format '{{.State.Running}}' fitclaw-bot 2>/dev/null)" == "true" ]] || return 1
}

freeze_failed_start() {
	log "The new release was allowed to start; freezing it and preserving both workspaces for manual rollback"
	FREEZE_CONFIRMED="true"
	if [[ "$(git_sha_if_present "$APP")" == "$RELEASE_SHA" ]]; then
		current_compose stop fitclaw-bot fitclaw-skill-runner >/dev/null 2>&1 || true
	else
		FREEZE_CONFIRMED="false"
	fi
	local container running_state
	for container in fitclaw-bot fitclaw-skill-runner; do
		if ! running_state="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null)"; then
			FREEZE_CONFIRMED="false"
		elif [[ "$running_state" != "false" ]]; then
			FREEZE_CONFIRMED="false"
		fi
	done
	if [[ "$FREEZE_CONFIRMED" != "true" ]]; then
		printf '[fitclaw-deploy] CRITICAL: one or more containers may still be running. Stop them and verify State.Running=false before moving any directory.\n' >&2
	fi
	STATUS="recovery_required"
	write_record || true
}

on_exit() {
	local exit_code=$?
	trap - EXIT
	if [[ $exit_code -eq 0 || "$EXIT_RECOVERY_ENABLED" != "true" ]]; then
		exit "$exit_code"
	fi

	set +e
	if [[ "$START_ATTEMPTED" == "true" || "$STATUS" == "starting" ]]; then
		freeze_failed_start
	elif [[ "$RECOVERING_PRE_START" == "true" ]]; then
		record_pre_start_recovery_failure
	elif [[ "$CUTOVER_STARTED_BY_SCRIPT" == "true" || "$STATUS" == "cutover_started" || "$STATUS" == "app_moved" || "$STATUS" == "directories_swapped" ]]; then
		RECOVERING_PRE_START=true
		if ! restore_old_runtime; then
			record_pre_start_recovery_failure
		fi
	elif [[ "$BOT_STOPPED_BY_SCRIPT" == "true" ]]; then
		if current_compose start fitclaw-bot >/dev/null 2>&1; then
			STATUS="prepared"
		else
			STATUS="recovery_required"
		fi
		write_record || true
	fi
	exit "$exit_code"
}

show_release_result() {
	current_compose ps
	current_compose logs --since=5m fitclaw-skill-runner fitclaw-bot
	log "Release containers are running, but the release is not yet verified."
	log "Complete the Feishu smoke test and critical JSON/JSONL checks, then run:"
	printf '  bash %q verify %q\n' "$0" "$RELEASE_SHA"
	log "Release record: $RELEASE_RECORD"
	log "Rollback directory: $BACKUP"
}

mark_verified() {
	[[ "$STATUS" == "containers_started" || "$STATUS" == "verified" ]] || die "Only a healthy containers_started release can be verified"
	validate_recorded_release_metadata
	verify_running_release || die "Current release containers do not match the release record or are unhealthy"
	if [[ "$STATUS" == "verified" ]]; then
		log "Release is already verified: $RELEASE_SHA"
		return
	fi
	VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	VERIFIED_BY="${USER:-unknown}"
	set_status verified
	log "Release verified after operator smoke checks: $RELEASE_SHA"
}

MODE="deploy"
if [[ "${1:-}" == "verify" ]]; then
	MODE="verify"
	shift
fi
if [[ "$#" -ne 1 ]]; then
	usage >&2
	exit 2
fi

REQUESTED_SHA="$1"
is_valid_sha "$REQUESTED_SHA" || die "Release SHA must contain exactly 40 lowercase hexadecimal characters"
[[ "$EUID" -ne 0 ]] || die "Run as the non-root deployment user; the script uses sudo only for owned runtime data"

for command_name in awk bash chmod cmp cp date df dirname docker find flock free git id install mkdir mktemp mv readlink rm sha256sum sleep sort stat sudo sync systemctl wc xargs; do
	require_command "$command_name"
done
sudo -n true || die "Passwordless sudo is required for the non-interactive release workflow"

CONFIG_HOME_ROOT="${FITCLAW_DEPLOY_HOME_ROOT:-$DEFAULT_HOME_ROOT}"
CONFIG_APP="${FITCLAW_DEPLOY_APP:-$CONFIG_HOME_ROOT/fitclaw}"
CONFIG_RECORD_DIR="$CONFIG_HOME_ROOT/fitclaw-release-records"
[[ "$CONFIG_HOME_ROOT" == /* && "$CONFIG_APP" == /* ]] || die "Deployment paths must be absolute"
[[ "$(dirname -- "$CONFIG_APP")" == "$CONFIG_HOME_ROOT" ]] || die "FITCLAW_DEPLOY_APP must be a direct child of FITCLAW_DEPLOY_HOME_ROOT"
[[ ! -L "$CONFIG_RECORD_DIR" ]] || die "Release record directory cannot be a symbolic link"
install -d -m 700 "$CONFIG_RECORD_DIR"

exec 9>"$CONFIG_RECORD_DIR/.deploy.lock"
flock -n 9 || die "Another FitClaw deployment is already running"

RELEASE_RECORD="$CONFIG_RECORD_DIR/$REQUESTED_SHA.env"
initialize_record_fields
EXIT_RECOVERY_ENABLED=false
BOT_STOPPED_BY_SCRIPT=false
CUTOVER_STARTED_BY_SCRIPT=false
START_ATTEMPTED=false
RECOVERING_PRE_START=false

if [[ -e "$RELEASE_RECORD" ]]; then
	load_record
else
	[[ "$MODE" == "deploy" ]] || die "Release record does not exist: $RELEASE_RECORD"
	HOME_ROOT="$CONFIG_HOME_ROOT"
	APP="$CONFIG_APP"
	RELEASE_ID="$REQUESTED_SHA"
	RELEASE_SHA="$REQUESTED_SHA"
	STAGE="$HOME_ROOT/fitclaw-release-$RELEASE_ID"
	BACKUP="$HOME_ROOT/fitclaw-previous-$RELEASE_ID"
	CANDIDATE_PROJECT="fitclaw_candidate_${RELEASE_SHA:0:12}"
	RELEASE_RECORD_DIR="$CONFIG_RECORD_DIR"
	[[ -d "$APP/.git" ]] || die "Current FitClaw checkout is missing: $APP"
	if [[ "$(git -C "$APP" rev-parse --verify HEAD)" == "$RELEASE_SHA" ]]; then
		die "Requested SHA is checked out but has no release record, so the running images cannot be proven; follow the first-install or manual recovery procedure"
	fi
	REPO_URL="${FITCLAW_DEPLOY_REPO_URL:-$(git -C "$APP" remote get-url origin)}"
	[[ -n "$REPO_URL" ]] || die "Git repository URL is empty"
	write_record
fi

EXIT_RECOVERY_ENABLED=true
trap on_exit EXIT

case "$STATUS" in
	prepared | bot_stopped | workspace_copied | skills_synced)
		if [[ "$(git_sha_if_present "$APP")" == "$OLD_RELEASE_SHA" && "$(docker inspect --format '{{.State.Running}}' fitclaw-bot 2>/dev/null || true)" == "false" ]]; then
			BOT_STOPPED_BY_SCRIPT=true
		fi
		;;
esac

[[ ! -L "$STAGE" && ! -L "$BACKUP" ]] || die "Release stage and backup paths cannot be symbolic links"

if [[ "$MODE" == "verify" ]]; then
	mark_verified
	EXIT_RECOVERY_ENABLED=false
	exit 0
fi

case "$STATUS" in
	verified)
		validate_recorded_release_metadata
		verify_running_release || die "Verified release no longer matches the running containers"
		log "Release is already deployed and verified: $RELEASE_SHA"
		EXIT_RECOVERY_ENABLED=false
		exit 0
		;;
	containers_started)
		validate_recorded_release_metadata
		verify_running_release || die "Started release no longer matches the running containers"
		show_release_result
		EXIT_RECOVERY_ENABLED=false
		exit 0
		;;
	starting)
		validate_recorded_release_metadata
		if verify_running_release; then
			DEPLOYED_AT="${DEPLOYED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
			set_status containers_started
			show_release_result
			EXIT_RECOVERY_ENABLED=false
			exit 0
		fi
		freeze_failed_start
		die "The new release did not become healthy; follow deployment guide section 10"
		;;
	recovery_required)
		EXIT_RECOVERY_ENABLED=false
		if [[ "$FREEZE_CONFIRMED" != "true" ]]; then
			printf '[fitclaw-deploy] CRITICAL: container freeze is not confirmed. Stop both containers and verify State.Running=false before rollback.\n' >&2
		fi
		die "This release requires manual recovery; preserve its directories and follow deployment guide section 10"
		;;
	cutover_started | app_moved | directories_swapped)
		validate_recorded_release_metadata
		RECOVERING_PRE_START=true
		restore_old_runtime
		RECOVERING_PRE_START=false
		;;
esac

preflight_current_release
free -h
df -h "$HOME_ROOT"

if [[ "$STATUS" == "initialized" ]]; then
	prepare_release
fi
validate_recorded_release_metadata

case "$STATUS" in
	bot_stopped | workspace_copied | skills_synced)
		if [[ "$(docker inspect --format '{{.State.Running}}' fitclaw-bot 2>/dev/null || true)" == "true" ]]; then
			log "Bot resumed after an earlier attempt; rebuilding the frozen workspace snapshot"
			set_status prepared
		else
			BOT_STOPPED_BY_SCRIPT=true
		fi
		;;
esac

case "$STATUS" in
	workspace_copied)
		clean_candidate_scratch
		validate_candidate_checkout
		if ! manifest_matches "$APP/feishu-workspace" "$SOURCE_MANIFEST" || ! manifest_matches "$STAGE/feishu-workspace" "$TARGET_MANIFEST"; then
			log "Copied workspace no longer matches its manifest; rebuilding the frozen snapshot"
			set_status bot_stopped
		fi
		;;
	skills_synced)
		clean_candidate_scratch
		validate_candidate_checkout
		if ! manifest_matches "$APP/feishu-workspace" "$SOURCE_MANIFEST" || ! manifest_matches "$STAGE/feishu-workspace" "$CUTOVER_MANIFEST"; then
			log "Runtime workspace no longer matches its cutover manifest; rebuilding the frozen snapshot"
			set_status bot_stopped
		fi
		;;
esac

if [[ "$STATUS" == "prepared" || "$STATUS" == "bot_stopped" ]]; then
	copy_workspace
fi
if [[ "$STATUS" == "workspace_copied" ]]; then
	sync_canonical_skills
fi
[[ "$STATUS" == "skills_synced" ]] || die "Release cannot enter cutover from state: $STATUS"
perform_cutover
show_release_result

EXIT_RECOVERY_ENABLED=false
