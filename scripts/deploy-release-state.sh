assert_record_value() {
	local key="$1"
	local value="$2"
	if [[ "$value" == *$'\n'* || "$value" == *$'\r'* || "$value" == *$'\t'* ]]; then
		die "Release record value contains a control character: $key"
	fi
}

record_line() {
	local key="$1"
	local value="$2"
	assert_record_value "$key" "$value"
	printf '%s=%q\n' "$key" "$value"
}

initialize_record_fields() {
	FORMAT_VERSION="1"
	HOME_ROOT=""
	APP=""
	REPO_URL=""
	RELEASE_ID=""
	RELEASE_SHA=""
	STAGE=""
	BACKUP=""
	CANDIDATE_PROJECT=""
	RELEASE_RECORD_DIR=""
	NEW_BOT_IMAGE=""
	NEW_RUNNER_IMAGE=""
	NEW_UID=""
	NEW_GID=""
	OLD_BOT_REF=""
	OLD_BOT_IMAGE=""
	OLD_RUNNER_REF=""
	OLD_RUNNER_IMAGE=""
	OLD_RELEASE_SHA=""
	OLD_UID=""
	OLD_GID=""
	SOURCE_STATS=""
	SOURCE_MANIFEST=""
	TARGET_MANIFEST=""
	RUNTIME_MANIFEST=""
	CUTOVER_MANIFEST=""
	DEPLOYED_AT=""
	VERIFIED_AT=""
	VERIFIED_BY=""
	FREEZE_CONFIRMED=""
	STATUS="initialized"
}

write_record() {
	local temporary_record
	temporary_record="$(mktemp "$RELEASE_RECORD_DIR/.release-record.XXXXXX")"
	chmod 600 "$temporary_record"
	{
		record_line FORMAT_VERSION "$FORMAT_VERSION"
		record_line HOME_ROOT "$HOME_ROOT"
		record_line APP "$APP"
		record_line REPO_URL "$REPO_URL"
		record_line RELEASE_ID "$RELEASE_ID"
		record_line RELEASE_SHA "$RELEASE_SHA"
		record_line STAGE "$STAGE"
		record_line BACKUP "$BACKUP"
		record_line CANDIDATE_PROJECT "$CANDIDATE_PROJECT"
		record_line RELEASE_RECORD_DIR "$RELEASE_RECORD_DIR"
		record_line NEW_BOT_IMAGE "$NEW_BOT_IMAGE"
		record_line NEW_RUNNER_IMAGE "$NEW_RUNNER_IMAGE"
		record_line NEW_UID "$NEW_UID"
		record_line NEW_GID "$NEW_GID"
		record_line OLD_BOT_REF "$OLD_BOT_REF"
		record_line OLD_BOT_IMAGE "$OLD_BOT_IMAGE"
		record_line OLD_RUNNER_REF "$OLD_RUNNER_REF"
		record_line OLD_RUNNER_IMAGE "$OLD_RUNNER_IMAGE"
		record_line OLD_RELEASE_SHA "$OLD_RELEASE_SHA"
		record_line OLD_UID "$OLD_UID"
		record_line OLD_GID "$OLD_GID"
		record_line SOURCE_STATS "$SOURCE_STATS"
		record_line SOURCE_MANIFEST "$SOURCE_MANIFEST"
		record_line TARGET_MANIFEST "$TARGET_MANIFEST"
		record_line RUNTIME_MANIFEST "$RUNTIME_MANIFEST"
		record_line CUTOVER_MANIFEST "$CUTOVER_MANIFEST"
		record_line DEPLOYED_AT "$DEPLOYED_AT"
		record_line VERIFIED_AT "$VERIFIED_AT"
		record_line VERIFIED_BY "$VERIFIED_BY"
		record_line FREEZE_CONFIRMED "$FREEZE_CONFIRMED"
		record_line STATUS "$STATUS"
	} >"$temporary_record"
	mv -- "$temporary_record" "$RELEASE_RECORD"
	sync -f "$RELEASE_RECORD"
}

load_record() {
	[[ -f "$RELEASE_RECORD" && ! -L "$RELEASE_RECORD" ]] || die "Invalid release record: $RELEASE_RECORD"
	[[ "$(stat -c '%u' "$RELEASE_RECORD")" == "$(id -u)" ]] || die "Release record must be owned by the deploy user"
	[[ "$(stat -c '%a' "$RELEASE_RECORD")" == "600" ]] || die "Release record mode must be 0600"

	initialize_record_fields
	local line key
	while IFS= read -r line; do
		[[ "$line" == *=* ]] || die "Malformed release record: $RELEASE_RECORD"
		key="${line%%=*}"
		case "$key" in
			FORMAT_VERSION | HOME_ROOT | APP | REPO_URL | RELEASE_ID | RELEASE_SHA | STAGE | BACKUP | CANDIDATE_PROJECT | RELEASE_RECORD_DIR | NEW_BOT_IMAGE | NEW_RUNNER_IMAGE | NEW_UID | NEW_GID | OLD_BOT_REF | OLD_BOT_IMAGE | OLD_RUNNER_REF | OLD_RUNNER_IMAGE | OLD_RELEASE_SHA | OLD_UID | OLD_GID | SOURCE_STATS | SOURCE_MANIFEST | TARGET_MANIFEST | RUNTIME_MANIFEST | CUTOVER_MANIFEST | DEPLOYED_AT | VERIFIED_AT | VERIFIED_BY | FREEZE_CONFIRMED | STATUS) ;;
			*) die "Unknown release record field: $key" ;;
		esac
	done <"$RELEASE_RECORD"
	bash -n "$RELEASE_RECORD" || die "Release record is not valid shell syntax"
	# The record is owned by this user, mode 0600, and stored in a mode 0700 directory.
	# Shell format keeps the emergency rollback commands in the deployment guide self-contained.
	# shellcheck disable=SC1090
	source "$RELEASE_RECORD"

	[[ "$FORMAT_VERSION" == "1" ]] || die "Unsupported release record format: $FORMAT_VERSION"
	[[ "$RELEASE_SHA" == "$REQUESTED_SHA" ]] || die "Release record SHA does not match the requested SHA"
	[[ "$RELEASE_ID" == "$REQUESTED_SHA" ]] || die "Release record ID is not the full requested SHA"
	[[ "$HOME_ROOT" == "$CONFIG_HOME_ROOT" ]] || die "Release record home root differs from this invocation"
	[[ "$APP" == "$CONFIG_APP" ]] || die "Release record app path differs from this invocation"
	[[ "$STAGE" == "$HOME_ROOT/fitclaw-release-$RELEASE_ID" ]] || die "Release record stage path is invalid"
	[[ "$BACKUP" == "$HOME_ROOT/fitclaw-previous-$RELEASE_ID" ]] || die "Release record backup path is invalid"
	[[ "$RELEASE_RECORD_DIR" == "$CONFIG_RECORD_DIR" ]] || die "Release record directory is invalid"
	[[ "$CANDIDATE_PROJECT" == "fitclaw_candidate_${RELEASE_SHA:0:12}" ]] || die "Release record project name is invalid"
	case "$STATUS" in
		initialized | prepared | bot_stopped | workspace_copied | skills_synced | cutover_started | app_moved | directories_swapped | starting | containers_started | verified | recovery_required) ;;
		*) die "Unknown release state: $STATUS" ;;
	esac
}

set_status() {
	STATUS="$1"
	write_record || return 1
	log "Release state: $STATUS"
}
