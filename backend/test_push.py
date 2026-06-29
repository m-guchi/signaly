"""push.py のユニットテスト"""

import unittest
from unittest.mock import patch

from push import (
    get_application_server_key,
    push_vapid_healthy,
    send_push_notifications,
    send_test_push_to_user,
    VAPID_SUBJECT,
)


class TestVapidHelpers(unittest.TestCase):
    @patch("push.push_configured", return_value=False)
    def test_push_vapid_healthy_not_configured(self, _configured):
        ok, err = push_vapid_healthy()
        self.assertFalse(ok)
        self.assertEqual(err, "not_configured")

    @patch("push.validate_push_config")
    @patch("push.push_configured", return_value=True)
    def test_push_vapid_healthy_ok(self, _configured, _validate):
        ok, err = push_vapid_healthy()
        self.assertTrue(ok)
        self.assertIsNone(err)


class TestSendPushNotifications(unittest.TestCase):
    @patch("push.resolve_notification_enabled", return_value=True)
    @patch("push.webpush")
    @patch("push._load_vapid")
    @patch("push._fetch_subscriptions")
    @patch("push.push_configured", return_value=True)
    def test_vapid_claims_are_not_reused_across_subscriptions(
        self, _configured, fetch_subs, _load_vapid, webpush, _resolve
    ):
        """各端末へ渡す vapid_claims が別オブジェクトであること"""
        fetch_subs.return_value = [
            {
                "id": "1",
                "email": "user@example.com",
                "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
                "p256dh": "k1",
                "auth": "a1",
            },
            {
                "id": "2",
                "email": "blocked@example.com",
                "endpoint": "https://web.push.apple.com/xyz",
                "p256dh": "k2",
                "auth": "a2",
            },
        ]

        captured = []

        def capture_claims(**kwargs):
            captured.append(dict(kwargs["vapid_claims"]))

        webpush.side_effect = capture_claims

        send_push_notifications(
            {
                "id": "n1",
                "channel": "test",
                "title": "t",
                "message": "m",
                "level": "info",
                "fields": [],
            }
        )

        self.assertEqual(webpush.call_count, 2)
        self.assertEqual(len(captured), 2)
        self.assertIsNot(captured[0], captured[1])
        self.assertEqual(captured[0]["sub"], VAPID_SUBJECT)
        self.assertEqual(captured[0]["aud"], "https://fcm.googleapis.com")
        self.assertEqual(captured[1]["aud"], "https://web.push.apple.com")

    @patch("push.resolve_notification_enabled")
    @patch("push.webpush")
    @patch("push._load_vapid")
    @patch("push._fetch_subscriptions")
    @patch("push.push_configured", return_value=True)
    def test_skips_disabled_users(
        self, _configured, fetch_subs, _load_vapid, webpush, resolve_enabled
    ):
        fetch_subs.return_value = [
            {
                "id": "1",
                "email": "allowed@example.com",
                "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
                "p256dh": "k1",
                "auth": "a1",
            },
            {
                "id": "2",
                "email": "blocked@example.com",
                "endpoint": "https://web.push.apple.com/xyz",
                "p256dh": "k2",
                "auth": "a2",
            },
        ]

        def enabled_for(email, _channel):
            return email != "blocked@example.com"

        resolve_enabled.side_effect = enabled_for

        send_push_notifications(
            {
                "id": "n1",
                "channel": "test",
                "title": "t",
                "message": "m",
                "level": "info",
                "fields": [],
            }
        )

        self.assertEqual(webpush.call_count, 1)


class TestSendTestPushToUser(unittest.TestCase):
    @patch("push.push_configured", return_value=False)
    def test_not_configured(self, _configured):
        result = send_test_push_to_user("user@example.com")
        self.assertEqual(result["error"], "not_configured")

    @patch("push.push_configured", return_value=True)
    @patch("push._fetch_subscriptions_for_email", return_value=[])
    def test_no_subscription(self, _fetch, _configured):
        result = send_test_push_to_user("user@example.com")
        self.assertEqual(result["error"], "no_subscription")

    @patch("push.webpush")
    @patch("push._load_vapid")
    @patch("push._fetch_subscriptions_for_email")
    @patch("push.push_configured", return_value=True)
    def test_sends_to_user_subscriptions(self, _configured, fetch_subs, load_vapid, webpush):
        vapid = object()
        load_vapid.return_value = vapid
        fetch_subs.return_value = [
            {
                "id": "1",
                "email": "user@example.com",
                "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
                "p256dh": "k1",
                "auth": "a1",
            },
        ]
        result = send_test_push_to_user("user@example.com")
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(webpush.call_count, 1)
        self.assertIs(webpush.call_args.kwargs["vapid_private_key"], vapid)

    @patch("push.webpush")
    @patch("push._load_vapid")
    @patch("push._fetch_subscriptions_for_email")
    @patch("push.push_configured", return_value=True)
    def test_filters_by_endpoint(self, _configured, fetch_subs, _load_vapid, webpush):
        fetch_subs.return_value = [
            {
                "id": "1",
                "email": "user@example.com",
                "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
                "p256dh": "k1",
                "auth": "a1",
            },
            {
                "id": "2",
                "email": "user@example.com",
                "endpoint": "https://web.push.apple.com/xyz",
                "p256dh": "k2",
                "auth": "a2",
            },
        ]
        result = send_test_push_to_user(
            "user@example.com",
            "https://web.push.apple.com/xyz",
        )
        self.assertEqual(result["sent"], 1)
        self.assertEqual(webpush.call_count, 1)


if __name__ == "__main__":
    unittest.main()
