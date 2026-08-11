=== Link Manager REST API ===
Requires at least: 5.8
Requires PHP: 7.4
Tested up to: 6.8
Stable tag: 1.0.4
License: GPLv2 or later

== Description ==

Exposes the classic WordPress Links/Link Manager records through a small authenticated REST API for Link Hub.

The plugin registers REST endpoints under `/wp-json/link-manager/v1/links` and supports listing, creating, reading, updating, and deleting links. It also handles link visibility and notes fields used by Link Hub.

== API ==

Base URL: `/wp-json/link-manager/v1/links`

Supported endpoints:
- `GET /wp-json/link-manager/v1/links`
- `POST /wp-json/link-manager/v1/links`
- `GET /wp-json/link-manager/v1/links/{id}`
- `PUT /wp-json/link-manager/v1/links/{id}`
- `DELETE /wp-json/link-manager/v1/links/{id}`

All routes require a WordPress Application Password belonging to an account with `manage_links` or administrator capability.

== Installation ==

Upload and activate the ZIP from WordPress Admin > Plugins > Add New > Upload Plugin.
