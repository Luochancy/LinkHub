<?php
/**
 * Plugin Name: Link Manager REST API
 * Description: Exposes the classic WordPress Links/Link Manager data for Link Hub.
 * Version: 1.0.4
 * Author: Luochancy
 */
if (!defined('ABSPATH')) exit;

// Link Manager functions are defined in wp-admin and are not loaded on REST requests by default.
if (!function_exists('wp_update_link')) require_once ABSPATH . 'wp-admin/includes/bookmark.php';

const LM_API_NAMESPACE = 'link-manager/v1';

register_activation_hook(__FILE__, function () { update_option('link_manager_enabled', 1); });

add_action('rest_api_init', function () {
    register_rest_route(LM_API_NAMESPACE, '/links', [
        ['methods' => WP_REST_Server::READABLE, 'callback' => 'lm_api_list_links', 'permission_callback' => 'lm_api_can_manage'],
        ['methods' => WP_REST_Server::CREATABLE, 'callback' => 'lm_api_create_link', 'permission_callback' => 'lm_api_can_manage'],
    ]);
    register_rest_route(LM_API_NAMESPACE, '/links/(?P<id>\d+)', [
        ['methods' => WP_REST_Server::READABLE, 'callback' => 'lm_api_get_link', 'permission_callback' => 'lm_api_can_manage'],
        ['methods' => WP_REST_Server::EDITABLE, 'callback' => 'lm_api_update_link', 'permission_callback' => 'lm_api_can_manage'],
        ['methods' => WP_REST_Server::DELETABLE, 'callback' => 'lm_api_delete_link', 'permission_callback' => 'lm_api_can_manage'],
    ]);
});

function lm_api_can_manage() { return current_user_can('manage_links') || current_user_can('manage_options'); }

function lm_api_list_links(WP_REST_Request $request) {
    nocache_headers();
    $args = ['orderby' => 'name', 'order' => 'ASC', 'limit' => -1, 'hide_invisible' => false];
    $visible = $request->get_param('visible');
    if ($visible === 'Y' || $visible === 'N') $args['visible'] = $visible;
    return array_map('lm_api_format_link', get_bookmarks($args));
}

function lm_api_get_link(WP_REST_Request $request) {
    nocache_headers();
    $links = get_bookmarks(['include' => [(int) $request['id']], 'hide_invisible' => false]);
    if (!$links) return new WP_Error('link_not_found', '友情链接不存在', ['status' => 404]);
    return lm_api_format_link($links[0]);
}

function lm_api_create_link(WP_REST_Request $request) {
    nocache_headers();
    $validation = lm_api_validate_input($request, true);
    if (is_wp_error($validation)) return $validation;
    $id = wp_insert_link(lm_api_link_data($request, true), true);
    if (is_wp_error($id)) return $id;
    $links = get_bookmarks(['include' => [(int) $id], 'hide_invisible' => false]);
    return new WP_REST_Response(lm_api_format_link($links[0]), 201);
}

function lm_api_update_link(WP_REST_Request $request) {
    nocache_headers();
    $validation = lm_api_validate_input($request, false);
    if (is_wp_error($validation)) return $validation;
    $id = (int) $request['id'];
    if (!get_bookmarks(['include' => [$id], 'hide_invisible' => false])) return new WP_Error('link_not_found', '友情链接不存在', ['status' => 404]);
    $data = lm_api_link_data($request, false); $data['link_id'] = $id;
    $result = wp_update_link($data, true);
    if (is_wp_error($result)) return $result;
    return lm_api_get_link($request);
}

function lm_api_delete_link(WP_REST_Request $request) {
    nocache_headers();
    $id = (int) $request['id'];
    if (!get_bookmarks(['include' => [$id], 'hide_invisible' => false])) return new WP_Error('link_not_found', '友情链接不存在', ['status' => 404]);
    if (!wp_delete_link($id)) return new WP_Error('delete_failed', '删除友情链接失败', ['status' => 500]);
    return ['success' => true];
}

function lm_api_link_data(WP_REST_Request $request, $create) {
    $map = ['name' => 'link_name', 'url' => 'link_url', 'description' => 'link_description', 'avatar' => 'link_image', 'notes' => 'link_notes', 'visible' => 'link_visible'];
    $data = [];
    foreach ($map as $from => $to) {
        if (!$create && !$request->has_param($from)) continue;
        $value = $request->get_param($from);
        if ($from === 'url' || $from === 'avatar') $value = esc_url_raw($value);
        elseif ($from === 'description' || $from === 'notes') $value = sanitize_textarea_field($value);
        elseif ($from === 'name') $value = sanitize_text_field($value);
        elseif ($from === 'visible') $value = $value === 'Y' ? 'Y' : 'N';
        $data[$to] = $value;
    }
    if ($create && empty($data['link_visible'])) $data['link_visible'] = 'N';
    return $data;
}

function lm_api_validate_input(WP_REST_Request $request, $create) {
    if ($create && (!$request->get_param('name') || !$request->get_param('url'))) {
        return new WP_Error('invalid_link', 'name 和 url 为必填项', ['status' => 400]);
    }
    if ($request->has_param('name') && strlen((string) $request->get_param('name')) > 600) {
        return new WP_Error('invalid_name', 'name 不能超过 200 个字符', ['status' => 400]);
    }
    if ($request->has_param('description') && strlen((string) $request->get_param('description')) > 3000) {
        return new WP_Error('invalid_description', 'description 不能超过 1000 个字符', ['status' => 400]);
    }
    foreach (['url', 'avatar'] as $field) {
        if (!$request->has_param($field) || $request->get_param($field) === '') continue;
        $url = esc_url_raw((string) $request->get_param($field));
        $scheme = strtolower((string) wp_parse_url($url, PHP_URL_SCHEME));
        $host = (string) wp_parse_url($url, PHP_URL_HOST);
        if (!$url || !$host || !in_array($scheme, ['http', 'https'], true) || preg_match('/[\r\n]/', $url)) {
            return new WP_Error('invalid_url', $field . ' 只允许 http 或 https 地址', ['status' => 400]);
        }
    }
    if ($request->has_param('visible') && !in_array($request->get_param('visible'), ['Y', 'N'], true)) {
        return new WP_Error('invalid_visible', 'visible 只能是 Y 或 N', ['status' => 400]);
    }
    return true;
}

function lm_api_format_link($link) {
    return ['id' => (int) $link->link_id, 'name' => (string) $link->link_name, 'url' => (string) $link->link_url, 'description' => (string) $link->link_description, 'avatar' => (string) $link->link_image, 'notes' => (string) $link->link_notes, 'link_notes' => (string) $link->link_notes, 'visible' => (string) $link->link_visible === 'Y', 'link_visible' => (string) $link->link_visible, 'owner' => (int) $link->link_owner];
}
