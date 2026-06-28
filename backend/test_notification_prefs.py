"""notification_prefs.py のユニットテスト"""

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from notification_prefs import (
    get_notification_settings,
    resolve_notification_enabled,
    set_channel_notification_setting,
    set_group_notification_setting,
    TARGET_CHANNEL,
    TARGET_GROUP,
)


def _mock_session(*, channel=None, settings=None):
    session = MagicMock()
    channel_query = MagicMock()
    channel_query.filter.return_value.first.return_value = channel
    session.query.side_effect = lambda model: {
        "Channel": channel_query,
        "NotificationSetting": MagicMock(),
        "ChannelGroup": MagicMock(),
    }.get(getattr(model, "__name__", str(model)), MagicMock())
    return session


class TestResolveNotificationEnabled(unittest.TestCase):
    @patch("notification_prefs.get_session")
    def test_defaults_to_enabled(self, get_session):
        session = MagicMock()
        channel = MagicMock(id="ch1", group_id=None)
        session.query.return_value.filter.return_value.first.side_effect = [
            channel,
            None,
        ]
        get_session.return_value.__enter__.return_value = session

        self.assertTrue(resolve_notification_enabled("user@example.com", "general"))

    @patch("notification_prefs.get_session")
    def test_channel_setting_overrides_group(self, get_session):
        session = MagicMock()
        channel = MagicMock(id="ch1", group_id="grp1")
        channel_setting = MagicMock(enabled=False)

        setting_q = MagicMock()
        setting_q.filter.return_value.first.return_value = channel_setting

        channel_q = MagicMock()
        channel_q.filter.return_value.first.return_value = channel

        def query_side_effect(model):
            if model.__name__ == "Channel":
                return channel_q
            if model.__name__ == "NotificationSetting":
                return setting_q
            return MagicMock()

        session.query.side_effect = query_side_effect
        get_session.return_value.__enter__.return_value = session

        self.assertFalse(resolve_notification_enabled("user@example.com", "alerts"))

    @patch("notification_prefs.get_session")
    def test_inherits_group_when_channel_not_set(self, get_session):
        session = MagicMock()
        channel = MagicMock(id="ch1", group_id="grp1")

        channel_setting = MagicMock(enabled=None)
        group_setting = MagicMock(enabled=False)

        channel_q = MagicMock()
        channel_q.filter.return_value.first.side_effect = [channel, channel_setting]

        group_q = MagicMock()
        group_q.filter.return_value.first.return_value = group_setting

        def query_side_effect(model):
            if model.__name__ == "Channel":
                return channel_q
            if model.__name__ == "NotificationSetting":
                return group_q
            return MagicMock()

        session.query.side_effect = query_side_effect
        get_session.return_value.__enter__.return_value = session

        self.assertFalse(resolve_notification_enabled("user@example.com", "alerts"))


class TestSetNotificationSettings(unittest.TestCase):
    @patch("notification_prefs.get_session")
    def test_set_channel_inherit_deletes_row(self, get_session):
        session = MagicMock()
        session.query.return_value.filter.return_value.first.side_effect = [
            MagicMock(id="ch1"),
            MagicMock(),
        ]
        get_session.return_value.__enter__.return_value = session

        set_channel_notification_setting("user@example.com", "ch1", None)

        session.delete.assert_called_once()
        session.commit.assert_called_once()

    @patch("notification_prefs.get_session")
    def test_set_group_disabled_creates_row(self, get_session):
        session = MagicMock()
        session.query.return_value.filter.return_value.first.side_effect = [
            MagicMock(id="grp1"),
            None,
        ]
        get_session.return_value.__enter__.return_value = session

        set_group_notification_setting("user@example.com", "grp1", False)

        session.add.assert_called_once()
        session.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
