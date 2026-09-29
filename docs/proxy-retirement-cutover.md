# Proxy retirement cutover runbook — GUID transition gate

Status: preparatory only. This is not deployment authorization or an executable
host-specific procedure. P10.2 must bind the reviewed GitOps state, consumer
instances, and approved operating window before any cutover; P10.3–P10.7 retain
their independent migration, writer, routing, and proxy-removal gates.

## RSS GUID transition

P03 changes Newznab GUIDs from the old website-plus-quality value to a stable
identity that includes source, edition, rendition, and search context. Previously
consumed releases can consequently reappear as new feed entries and cause duplicate
grabs. Equal titles alone are not proof that two releases are the same edition.
Known short-lived media access parameters are excluded from that identity; the
media path, unrecognized query selectors, edition, and explicit quality remain
identity-bearing. The current RSS/NZB path still forwards the provider's current
download URL, so GUID stability does not make an old queued URL fresh.

Before the P10.6 routing gate can open:

1. Compare old and new GUIDs using synthetic RSS/NZB fixtures, including distinct
   audio editions and 720p/1080p renditions. Preserve the comparison as review
   evidence; do not query production feeds for this development check.
2. Under the separately authorized operations window, reconcile queued, active,
   failed, and unimported download history against the feed transition. If an
   existing release cannot be matched safely, stop rather than infer identity from
   its title.
3. Keep automated acquisition paused while changing routes. Verify that exactly
   one indexer/RSS route and one download-client route are active before resuming;
   never run old and native routes together as a deduplication strategy.
4. If duplicate-grab risk or active-job state is unresolved, keep the routing gate
   closed and retain the existing route. Resume only under P10's explicit gates.

This note records a risk and a stop condition; it does not authorize reading or
changing a production feed, queue, history, service, or route.
