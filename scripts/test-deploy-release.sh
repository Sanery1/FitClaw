#!/usr/bin/env bash

set -Eeuo pipefail

export PATH="/usr/bin:/bin:$PATH"
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-release.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fitclaw-deploy-test.XXXXXX")"
readonly TEST_HOME="$TEST_ROOT/test-home"

export HOME="$TEST_HOME"
export XDG_CONFIG_HOME="$TEST_HOME/.config"
mkdir -p -- "$XDG_CONFIG_HOME"

cleanup() {
	if [[ "${KEEP_DEPLOY_TEST_ROOT:-0}" == "1" ]]; then
		printf 'Preserved deploy test root: %s\n' "$TEST_ROOT" >&2
		return
	fi
	case "$TEST_ROOT" in
		*/fitclaw-deploy-test.*) rm -rf -- "$TEST_ROOT" ;;
		*) printf 'Refusing to remove unexpected test path: %s\n' "$TEST_ROOT" >&2 ;;
	esac
}
trap cleanup EXIT

fail() {
	printf 'not ok - %s\n' "$*" >&2
	exit 1
}

assert_eq() {
	local expected="$1"
	local actual="$2"
	local message="$3"
	[[ "$actual" == "$expected" ]] || fail "$message (expected: $expected, actual: $actual)"
}

assert_file_contains() {
	local path="$1"
	local pattern="$2"
	local message="$3"
	grep -F -- "$pattern" "$path" >/dev/null || fail "$message"
}

assert_file_lacks() {
	local path="$1"
	local pattern="$2"
	local message="$3"
	if grep -F -- "$pattern" "$path" >/dev/null; then
		fail "$message"
	fi
}

make_fake_commands() {
	local fake_bin="$1"
	mkdir -p -- "$fake_bin"

	cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"

readonly OLD_BOT_IMAGE="sha256:old-bot"
readonly OLD_RUNNER_IMAGE="sha256:old-runner"
readonly NEW_BOT_IMAGE="sha256:new-bot"
readonly NEW_RUNNER_IMAGE="sha256:new-runner"
readonly OLD_BOT_REF="fitclaw-fitclaw-bot"
readonly OLD_RUNNER_REF="fitclaw-fitclaw-skill-runner"

state_value() {
	local name="$1"
	local fallback="$2"
	if [[ -f "$FAKE_DOCKER_STATE_DIR/$name" ]]; then
		local value
		IFS= read -r value <"$FAKE_DOCKER_STATE_DIR/$name"
		printf '%s\n' "$value"
	else
		printf '%s\n' "$fallback"
	fi
}

compose_command() {
	local argument
	for argument in "$@"; do
		case "$argument" in
			version | config | build | stop | start | up | ps | logs)
				printf '%s\n' "$argument"
				return
				;;
		esac
	done
}

case "${1:-}" in
	info)
		exit 0
		;;
	compose)
		command_name="$(compose_command "${@:2}")"
		case "$command_name" in
			build)
				[[ "${FAKE_DOCKER_FAIL_BUILD:-0}" != "1" ]]
				;;
			stop)
				[[ "${FAKE_DOCKER_FAIL_STOP:-0}" != "1" ]] || exit 1
				if [[ "${FAKE_DOCKER_FAIL_FREEZE:-0}" == "1" && " $* " == *" fitclaw-bot "* && " $* " == *" fitclaw-skill-runner "* ]]; then
					exit 1
				fi
				for argument in "$@"; do
					case "$argument" in
						fitclaw-bot) printf 'false\n' >"$FAKE_DOCKER_STATE_DIR/bot-running" ;;
						fitclaw-skill-runner) printf 'false\n' >"$FAKE_DOCKER_STATE_DIR/runner-running" ;;
					esac
				done
				;;
			start)
				for argument in "$@"; do
					case "$argument" in
						fitclaw-bot) printf 'true\n' >"$FAKE_DOCKER_STATE_DIR/bot-running" ;;
						fitclaw-skill-runner) printf 'true\n' >"$FAKE_DOCKER_STATE_DIR/runner-running" ;;
					esac
				done
				;;
			up)
				printf 'true\n' >"$FAKE_DOCKER_STATE_DIR/bot-running"
				printf 'true\n' >"$FAKE_DOCKER_STATE_DIR/runner-running"
				;;
			*) exit 0 ;;
		esac
		;;
	image)
		[[ "${2:-}" == "inspect" ]] || exit 1
		if [[ "${3:-}" == "--format" ]]; then
			case "${5:-}" in
				*-fitclaw-bot) printf '%s\n' "$NEW_BOT_IMAGE" ;;
				*-fitclaw-skill-runner) printf '%s\n' "$NEW_RUNNER_IMAGE" ;;
				*) exit 1 ;;
			esac
		fi
		;;
	inspect)
		if [[ "${2:-}" != "--format" ]]; then
			exit 0
		fi
		format="${3:-}"
		container="${4:-}"
		case "$format" in
			'{{index .Config.Labels "com.docker.compose.project"}}') printf 'fitclaw\n' ;;
			'{{index .Config.Labels "com.docker.compose.service"}}')
				case "$container" in
					fitclaw-bot) printf 'fitclaw-bot\n' ;;
					fitclaw-skill-runner) printf 'fitclaw-skill-runner\n' ;;
					*) exit 1 ;;
				esac
				;;
			*'/opt/fitclaw/feishu-workspace'*)
				workspace_source="$(cd -- "$FITCLAW_DEPLOY_APP/feishu-workspace" && pwd -P)"
				case "$container" in
					fitclaw-bot) printf 'bind|%s|true\n' "$workspace_source" ;;
					fitclaw-skill-runner) printf 'bind|%s|false\n' "$workspace_source" ;;
					*) exit 1 ;;
				esac
				;;
			*'/run/fitclaw-skill-runner'*) printf 'volume|fitclaw_skill-runner-socket|true\n' ;;
			'{{.Config.Image}}')
				case "$container" in
					fitclaw-bot) printf '%s\n' "$OLD_BOT_REF" ;;
					fitclaw-skill-runner) printf '%s\n' "$OLD_RUNNER_REF" ;;
					*) exit 1 ;;
				esac
				;;
			'{{.Image}}')
				case "$container" in
					fitclaw-bot) state_value bot-image "$OLD_BOT_IMAGE" ;;
					fitclaw-skill-runner) state_value runner-image "$OLD_RUNNER_IMAGE" ;;
					*) exit 1 ;;
				esac
				;;
			'{{if .State.Health}}{{.State.Health.Status}}{{end}}')
				printf '%s\n' "${FAKE_RUNNER_HEALTH:-healthy}"
				;;
			'{{.State.Running}}')
				case "$container" in
					fitclaw-bot) state_value bot-running true ;;
					fitclaw-skill-runner) state_value runner-running true ;;
					*) exit 1 ;;
				esac
				;;
			*) exit 1 ;;
		esac
		;;
	run)
		if [[ " $* " == *" --entrypoint id "* ]]; then
			printf '1000\n'
		fi
		;;
	volume)
		[[ "${2:-}" == "inspect" ]]
		;;
	tag)
		case "${3:-}" in
			"$OLD_BOT_REF") printf '%s\n' "${2:-}" >"$FAKE_DOCKER_STATE_DIR/bot-image" ;;
			"$OLD_RUNNER_REF") printf '%s\n' "${2:-}" >"$FAKE_DOCKER_STATE_DIR/runner-image" ;;
			*) exit 1 ;;
		esac
		;;
	*) exit 1 ;;
esac
EOF

	cat >"$fake_bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" == "-n" ]]; then
	shift
fi
case "${1:-}" in
	systemctl | chown) exit 0 ;;
	*) exec "$@" ;;
esac
EOF

	cat >"$fake_bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
	cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
	cat >"$fake_bin/install" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" == "-d" ]]; then
	shift
	if [[ "${1:-}" == "-m" ]]; then
		shift 2
	fi
	mkdir -p -- "$@"
	exit 0
fi
if [[ "${1:-}" == "-m" ]]; then
	mode="$2"
	shift 2
else
	mode=""
fi
cp -- "$1" "$2"
if [[ -n "$mode" ]]; then
	chmod "$mode" "$2"
fi
EOF
	cat >"$fake_bin/free" <<'EOF'
#!/usr/bin/env bash
printf 'fake memory report\n'
EOF
	cat >"$fake_bin/df" <<'EOF'
#!/usr/bin/env bash
printf 'fake disk report\n'
EOF
	cat >"$fake_bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
	cat >"$fake_bin/sync" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
	chmod +x "$fake_bin"/*
}

create_fixture() {
	local case_root="$1"
	local seed="$case_root/seed"

	HOME_ROOT="$case_root/home"
	APP="$HOME_ROOT/fitclaw"
	FAKE_BIN="$case_root/fake-bin"
	FAKE_DOCKER_LOG="$case_root/docker.log"
	FAKE_DOCKER_STATE_DIR="$case_root/docker-state"
	OUTPUT_FILE="$case_root/output.log"
	mkdir -p -- "$seed/.fitclaw/skills/demo" "$HOME_ROOT" "$FAKE_DOCKER_STATE_DIR"
	: >"$FAKE_DOCKER_LOG"

	git init --quiet "$seed"
	git -C "$seed" config user.name "FitClaw Deploy Test"
	git -C "$seed" config user.email "deploy-test@example.invalid"
	git -C "$seed" config core.autocrlf false
	printf '.env\nfeishu-workspace/\n' >"$seed/.gitignore"
	printf 'services: {}\n' >"$seed/docker-compose.yml"
	printf '%s\n' '# Demo Skill' >"$seed/.fitclaw/skills/demo/SKILL.md"
	printf 'old\n' >"$seed/release-marker.txt"
	git -C "$seed" add .gitignore docker-compose.yml .fitclaw/skills/demo/SKILL.md release-marker.txt
	git -C "$seed" commit --quiet -m "old release"
	OLD_SHA="$(git -C "$seed" rev-parse HEAD)"

	printf 'new\n' >"$seed/release-marker.txt"
	git -C "$seed" add release-marker.txt
	git -C "$seed" commit --quiet -m "new release"
	TARGET_SHA="$(git -C "$seed" rev-parse HEAD)"

	git -c core.autocrlf=false clone --quiet "$seed" "$APP"
	git -C "$APP" checkout --quiet --detach "$OLD_SHA"
	mkdir -p -- "$APP/feishu-workspace"
	printf '{"release":"old"}\n' >"$APP/feishu-workspace/state.json"
	printf 'FEISHU_APP_ID=test\n' >"$APP/.env"
	chmod 600 "$APP/.env"
	make_fake_commands "$FAKE_BIN"
}

run_release() {
	local build_failure="$1"
	local runner_health="$2"
	shift 2
	set +e
	PATH="$FAKE_BIN:$PATH" \
		FITCLAW_DEPLOY_HOME_ROOT="$HOME_ROOT" \
		FITCLAW_DEPLOY_APP="$APP" \
		FAKE_DOCKER_LOG="$FAKE_DOCKER_LOG" \
		FAKE_DOCKER_STATE_DIR="$FAKE_DOCKER_STATE_DIR" \
		FAKE_DOCKER_FAIL_BUILD="$build_failure" \
		FAKE_DOCKER_FAIL_FREEZE="${FAKE_DOCKER_FAIL_FREEZE_OVERRIDE:-0}" \
		FAKE_RUNNER_HEALTH="$runner_health" \
		bash "$DEPLOY_SCRIPT" "$@" >"$OUTPUT_FILE" 2>&1
	RUN_STATUS=$?
	set -e
}

test_usage_and_sha_validation() {
	local case_root="$TEST_ROOT/arguments"
	local output="$case_root/output.log"
	mkdir -p -- "$case_root"

	set +e
	bash "$DEPLOY_SCRIPT" >"$output" 2>&1
	local status=$?
	set -e
	assert_eq "2" "$status" "missing release SHA should be a usage error"
	assert_file_contains "$output" "Usage:" "missing release SHA should print help"

	set +e
	bash "$DEPLOY_SCRIPT" "ABC" >"$output" 2>&1
	status=$?
	set -e
	assert_eq "1" "$status" "malformed release SHA should fail"
	assert_file_contains "$output" "exactly 40 lowercase hexadecimal characters" "SHA error should explain the accepted format"
	printf 'ok - usage and SHA validation\n'
}

test_build_failure_keeps_old_service_running() {
	local case_root="$TEST_ROOT/build-failure"
	create_fixture "$case_root"
	run_release 1 healthy "$TARGET_SHA"

	assert_eq "1" "$RUN_STATUS" "candidate build failure should fail the release"
	assert_file_contains "$FAKE_DOCKER_LOG" " build" "candidate build should have been attempted"
	assert_file_lacks "$FAKE_DOCKER_LOG" " stop fitclaw-bot" "Bot must not stop before a candidate image builds"
	assert_eq "$OLD_SHA" "$(git -C "$APP" rev-parse HEAD)" "build failure must leave the current checkout unchanged"
	[[ ! -e "$HOME_ROOT/fitclaw-previous-$TARGET_SHA" ]] || fail "build failure must not create a rollback directory"
	assert_file_contains "$HOME_ROOT/fitclaw-release-records/$TARGET_SHA.env" "STATUS=initialized" "build failure should remain resumable from initialized"
	printf 'ok - build failure leaves the old service untouched\n'
}

test_successful_release_reaches_containers_started() {
	local case_root="$TEST_ROOT/success"
	create_fixture "$case_root"
	run_release 0 healthy "$TARGET_SHA"

	assert_eq "0" "$RUN_STATUS" "healthy candidate should deploy successfully"
	assert_eq "$TARGET_SHA" "$(git -C "$APP" rev-parse HEAD)" "successful release should move the candidate into the app path"
	assert_eq "$OLD_SHA" "$(git -C "$HOME_ROOT/fitclaw-previous-$TARGET_SHA" rev-parse HEAD)" "successful release should retain the old checkout"
	[[ ! -e "$HOME_ROOT/fitclaw-release-$TARGET_SHA" ]] || fail "candidate stage should be consumed by a successful cutover"
	assert_file_contains "$HOME_ROOT/fitclaw-release-records/$TARGET_SHA.env" "STATUS=containers_started" "successful release should await operator verification"
	assert_file_contains "$FAKE_DOCKER_LOG" " stop fitclaw-bot" "successful release should freeze the workspace before copying"
	assert_file_contains "$FAKE_DOCKER_LOG" " up -d --force-recreate --no-build" "successful release should recreate containers without rebuilding"
	printf 'ok - healthy release reaches containers_started\n'
}

test_failed_start_preserves_both_releases() {
	local case_root="$TEST_ROOT/failed-start"
	create_fixture "$case_root"
	run_release 0 unhealthy "$TARGET_SHA"

	assert_eq "1" "$RUN_STATUS" "unhealthy candidate should fail the release"
	assert_eq "$TARGET_SHA" "$(git -C "$APP" rev-parse HEAD)" "failed start should preserve the candidate at the app path for diagnosis"
	assert_eq "$OLD_SHA" "$(git -C "$HOME_ROOT/fitclaw-previous-$TARGET_SHA" rev-parse HEAD)" "failed start should preserve the old checkout for manual rollback"
	assert_file_contains "$HOME_ROOT/fitclaw-release-records/$TARGET_SHA.env" "STATUS=recovery_required" "failed start must require explicit recovery"
	assert_file_contains "$HOME_ROOT/fitclaw-release-records/$TARGET_SHA.env" "FREEZE_CONFIRMED=true" "normal failed start should confirm both containers stopped"
	assert_file_contains "$FAKE_DOCKER_LOG" " stop fitclaw-bot fitclaw-skill-runner" "failed start should freeze both new containers"
	assert_file_contains "$OUTPUT_FILE" "preserving both workspaces for manual rollback" "failure output should explain the preservation boundary"
	printf 'ok - failed start freezes and preserves both releases\n'
}

test_candidate_tampering_is_rejected() {
	local case_root="$TEST_ROOT/candidate-tampering"
	create_fixture "$case_root"
	run_release 1 healthy "$TARGET_SHA"
	printf 'unexpected\n' >"$HOME_ROOT/fitclaw-release-$TARGET_SHA/tampered.txt"
	run_release 0 healthy "$TARGET_SHA"

	assert_eq "1" "$RUN_STATUS" "an untracked candidate file should fail the release"
	assert_file_contains "$OUTPUT_FILE" "tracked or untracked changes" "candidate integrity error should be explicit"
	assert_file_lacks "$FAKE_DOCKER_LOG" " stop fitclaw-bot" "candidate tampering must be rejected before stopping the Bot"
	assert_eq "$OLD_SHA" "$(git -C "$APP" rev-parse HEAD)" "candidate tampering must leave the current checkout unchanged"
	printf 'ok - candidate tampering is rejected\n'
}

test_workspace_skill_collision_is_rejected_before_stop() {
	local case_root="$TEST_ROOT/skill-collision"
	create_fixture "$case_root"
	mkdir -p -- "$case_root/seed/.fitclaw/skills/local-name" "$APP/feishu-workspace/skills/local-name"
	printf '%s\n' '# New canonical Skill' >"$case_root/seed/.fitclaw/skills/local-name/SKILL.md"
	printf '%s\n' '# Existing workspace Skill' >"$APP/feishu-workspace/skills/local-name/SKILL.md"
	git -C "$case_root/seed" add .fitclaw/skills/local-name/SKILL.md
	git -C "$case_root/seed" commit --quiet -m "add colliding canonical skill"
	TARGET_SHA="$(git -C "$case_root/seed" rev-parse HEAD)"
	run_release 0 healthy "$TARGET_SHA"

	assert_eq "1" "$RUN_STATUS" "a canonical/workspace Skill collision should fail the release"
	assert_file_contains "$OUTPUT_FILE" "collides with a workspace-only Skill" "Skill collision error should be explicit"
	assert_file_lacks "$FAKE_DOCKER_LOG" " stop fitclaw-bot" "Skill collision must be rejected before stopping the Bot"
	assert_eq "$OLD_SHA" "$(git -C "$APP" rev-parse HEAD)" "Skill collision must leave the current checkout unchanged"
	printf 'ok - workspace Skill collision is rejected before stop\n'
}

test_unconfirmed_freeze_is_recorded() {
	local case_root="$TEST_ROOT/unconfirmed-freeze"
	create_fixture "$case_root"
	FAKE_DOCKER_FAIL_FREEZE_OVERRIDE=1 run_release 0 unhealthy "$TARGET_SHA"

	assert_eq "1" "$RUN_STATUS" "an unhealthy release with a failed freeze should fail"
	assert_file_contains "$HOME_ROOT/fitclaw-release-records/$TARGET_SHA.env" "FREEZE_CONFIRMED=false" "failed container freeze must remain unconfirmed"
	assert_file_contains "$OUTPUT_FILE" "CRITICAL: one or more containers may still be running" "failed freeze should require an explicit stop check"
	printf 'ok - unconfirmed freeze is recorded\n'
}

[[ -f "$DEPLOY_SCRIPT" ]] || fail "deployment script is missing: $DEPLOY_SCRIPT"

test_usage_and_sha_validation
test_build_failure_keeps_old_service_running
test_successful_release_reaches_containers_started
test_failed_start_preserves_both_releases
test_candidate_tampering_is_rejected
test_workspace_skill_collision_is_rejected_before_stop
test_unconfirmed_freeze_is_recorded
printf 'all deploy-release tests passed\n'
