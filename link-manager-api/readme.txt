=== Link Manager REST API ===
Requires at least: 5.8
Requires PHP: 7.4
Tested up to: 6.8
Stable tag: 1.0.2
License: GPLv2 or later

== Description ==

Exposes the classic WordPress Links/Link Manager records through a small authenticated REST API for Link Hub.

This plugin does not create users, execute remote URLs, expose credentials, or expose link notes anonymously.

== API ==

Base URL: `/wp-json/link-manager/v1/links`

All routes require a WordPress Application Password belonging to an account with `manage_links` or administrator capability.

== Installation ==

Upload and activate the ZIP from WordPress Admin > Plugins > Add New > Upload Plugin.
