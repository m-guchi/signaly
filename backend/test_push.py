"""push.py のユニットテスト"""

import unittest
from unittest.mock import patch

from push import send_push_notifications, VAPID_SUBJECT


class TestSendPushNotifications(unittest.TestCase):
    @patch("push.webpush")
    @patch("push._load_vapid")
    @patch("push._fetch_subscriptions")
    @patch("push.push_configured", return_value=True)
    def test_vapid_claims_are_not_reused_across_subscriptions(
        self, _configured, fetch_subs, _load_vapid, webpush
    ):
        """各端末へ渡す vapid_claims が別オブジェクトであること"""
        fetch_subs.return_value = [
            {
                "id": "1",
                "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
                "p256dh": "k1",
                "auth": "a1",
            },
            {
                "id": "2",
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
        expected = {"sub": VAPID_SUBJECT}
        self.assertEqual(captured[0], expected)
        self.assertEqual(captured[1], expected)


if __name__ == "__main__":
    unittest.main()
