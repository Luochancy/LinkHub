=== Link Manager REST API ===
Contributors: luochancy
Tags: links, rest-api, link-manager, application-passwords
Requires at least: 5.6
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.4
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Expose the WordPress Links Manager through an authenticated REST API for LinkHub.

== Description ==

This companion plugin connects LinkHub to the native WordPress Links Manager (`wp_links`). It provides REST endpoints for reading, creating, updating and deleting links.

Responsibilities:

* Expose WordPress links as structured JSON.
* Allow authenticated LinkHub administrators to import, create, update, hide and delete links.
* Store LinkHub ownership metadata in `link_notes`.
* Protect every REST route with WordPress capabilities.
* Sanitize and validate incoming fields before writing to WordPress.

The plugin does not implement GitHub OAuth, LinkHub sessions, Cloudflare KV storage or the LinkHub admin interface. Those features belong to the LinkHub Worker application.

== Installation ==

1. Upload `link-manager-api-flat.zip` through Plugins > Add New > Upload Plugin, or copy the `link-manager-api` directory to `/wp-content/plugins/`.
2. Activate "Link Manager REST API".
3. Make sure the WordPress Links Manager is available on the site.
4. Create a WordPress Application Password for a dedicated user.
5. Give that user the `manage_links` or `manage_options` capability.
6. Configure LinkHub:
   * `WP_LINKS_URL=https://example.com/wp-json/link-manager/v1/links`
   * `WP_USERNAME=<wordpress-login>`
   * `WP_APPLICATION_PASSWORD=<application-password>`

Use a WordPress Application Password, not the account login password.

== REST API ==

Base route:

`/wp-json/link-manager/v1`

All routes require a WordPress user with `manage_links` or `manage_options`. For remote LinkHub deployments, authenticate over HTTPS with a WordPress Application Password.

= GET /links =

Returns links. Query filtering:

* `?visible=Y` returns visible links.
* `?visible=N` returns hidden links.
* Omitting `visible` returns all links.

Response fields:

* `id` - WordPress `link_id`
* `name` - site name
* `url` - destination URL
* `description` - site description
* `avatar` - avatar or logo URL from `link_image`
* `visible` - boolean visibility
* `link_visible` - raw `Y` or `N` value
* `notes` - WordPress link notes
* `link_notes` - compatibility alias for `notes`
* `owner` - WordPress link owner ID

= GET /links/{id} =

Returns one link. Responds with 404 when it does not exist.

= POST /links =

Creates a link.

Required fields:

* `name`
* `url`

Optional fields:

* `description`
* `avatar`
* `visible`
* `notes`

= PUT /links/{id} =

Updates an existing link.

Accepted fields: `name`, `url`, `description`, `avatar`, `visible`, `notes`.

= DELETE /links/{id} =

Deletes an existing link.

== Ownership markers ==

When a LinkHub administrator assigns an imported WordPress link to a GitHub user, LinkHub writes two lines to `link_notes`:

`link-manager:github:<github-numeric-id>`

`link-manager:login:<github-login>`

Example:

`link-manager:github:86495643`

`link-manager:login:luochancy`

The numeric GitHub ID is the stable ownership key. The login is stored for display. Links without the GitHub ID marker are treated as unowned. They can only be assigned by a LinkHub administrator; users cannot claim arbitrary imported links themselves.

Important: the current LinkHub synchronization code rewrites `link_notes` with these ownership markers when assigning, unassigning or editing a synchronized link. Existing ordinary notes are not merged automatically. Back up important notes before using the field for LinkHub ownership metadata.

== Validation and sanitization ==

The plugin:

* Accepts only HTTP and HTTPS destination URLs with a valid host.
* Sanitizes `url` and `avatar` with `esc_url_raw()`.
* Sanitizes names with `sanitize_text_field()`.
* Sanitizes descriptions and notes with `sanitize_textarea_field()`.
* Normalizes visibility to `Y` or `N`.
* Rejects a raw name longer than 600 bytes (reported as approximately 200 characters).
* Rejects a raw description longer than 3000 bytes (reported as approximately 1000 characters).
* Does not currently apply an explicit application-level length limit to `avatar` or `notes`; WordPress database field limits still apply.

The implementation uses PHP `strlen()`, so the effective character count varies for UTF-8 text.

== Authentication and permissions ==

Every route, including GET routes, requires either `manage_links` or `manage_options`.

For remote LinkHub deployments, WordPress Application Passwords provide Basic Authentication over HTTPS. Always use HTTPS and a dedicated least-privilege account.

== Frequently Asked Questions ==

= The endpoint returns 404 =

Confirm that the plugin is activated. Visit Settings > Permalinks and save once to refresh routing if necessary. The expected endpoint is `/wp-json/link-manager/v1/links`.

= Requests return 401 or 403 =

Check `WP_USERNAME`, the Application Password and the user's capabilities. Security plugins, proxies or web servers may also strip the `Authorization` header.

= Should I use my normal WordPress password? =

No. Create a separate Application Password under the WordPress user profile.

= Can users claim old WordPress links themselves? =

No. LinkHub administrators assign the GitHub numeric ID. Once assigned, the owner can edit the link from LinkHub's "My Links" page.

== Changelog ==

= 1.0.4 =
* Add size checks, sanitization and stricter URL validation.
* Support LinkHub ownership markers in link notes.
* Require WordPress link-management capabilities for all REST routes.

= 1.0.3 =
* Reject unsupported URL schemes.
* Return normalized REST response fields.

= 1.0.0 =
* Initial release.