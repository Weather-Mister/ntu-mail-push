import os
import json
import poplib
import base64
import tempfile
from pathlib import Path
from email import policy
from email.parser import BytesParser

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from pywebpush import webpush


HOST = "msa.ntu.edu.tw"
PORT = 995

STATE_PATH = Path("state.json")
WEBMAIL_URL = "https://wmail1.cc.ntu.edu.tw/rc/index.php"

NTU_EMAIL = os.environ["NTU_EMAIL"].strip()
NTU_PASSWORD = os.environ["NTU_PASSWORD"]
PUSH_SUBSCRIPTION = os.environ["PUSH_SUBSCRIPTION"].strip()
VAPID_PRIVATE_KEY = os.environ["VAPID_PRIVATE_KEY"].strip()

USERNAME = NTU_EMAIL.split("@", 1)[0]


def load_state():
    if not STATE_PATH.exists():
        return {
            "initialized": False,
            "seen_uids": []
        }

    try:
        data = json.loads(
            STATE_PATH.read_text(encoding="utf-8")
        )

        return {
            "initialized": bool(data.get("initialized")),
            "seen_uids": list(data.get("seen_uids") or [])
        }

    except Exception:
        return {
            "initialized": False,
            "seen_uids": []
        }


def save_state(uids):
    STATE_PATH.write_text(
        json.dumps(
            {
                "initialized": True,
                "seen_uids": uids
            },
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )


def b64url_decode(value):
    value = value.strip()

    value += "=" * (
        (4 - len(value) % 4) % 4
    )

    return base64.urlsafe_b64decode(
        value.encode("ascii")
    )


def make_vapid_pem(value):
    raw = b64url_decode(value)

    if len(raw) != 32:
        raise RuntimeError(
            "VAPID_PRIVATE_KEY should decode to exactly 32 bytes."
        )

    scalar = int.from_bytes(
        raw,
        "big"
    )

    key = ec.derive_private_key(
        scalar,
        ec.SECP256R1()
    )

    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )

    return pem


def clean(value, fallback, limit):
    text = " ".join(
        str(value or fallback).split()
    )

    if len(text) > limit:
        return text[:limit - 1] + "…"

    return text


def get_header(mailbox, message_number):

    try:
        _, lines, _ = mailbox.top(
            message_number,
            0
        )

    except poplib.error_proto:

        _, lines, _ = mailbox.retr(
            message_number
        )

    raw = (
        b"\r\n".join(lines)
        + b"\r\n\r\n"
    )

    msg = BytesParser(
        policy=policy.default
    ).parsebytes(raw)

    return {
        "from": clean(
            msg.get("From"),
            "NTU Mail",
            80
        ),

        "subject": clean(
            msg.get("Subject"),
            "(no subject)",
            110
        )
    }


def send_push(messages):

    subscription = json.loads(
        PUSH_SUBSCRIPTION
    )

    pem = make_vapid_pem(
        VAPID_PRIVATE_KEY
    )

    temp_path = None

    try:

        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".pem",
            delete=False
        ) as temp_file:

            temp_file.write(pem)
            temp_path = temp_file.name

        if len(messages) == 1:

            message = messages[0]

            payload = {
                "title": "New NTU Mail",

                "body":
                    f'{message["from"]} — '
                    f'{message["subject"]}',

                "tag": "ntu-mail",

                "url": WEBMAIL_URL
            }

        else:

            preview = "\n".join(
                message["subject"]
                for message in messages[:3]
            )

            if len(messages) > 3:
                preview += (
                    f"\n+{len(messages) - 3} more"
                )

            payload = {
                "title":
                    f"{len(messages)} new NTU emails",

                "body": preview,

                "tag": "ntu-mail",

                "url": WEBMAIL_URL
            }

        webpush(
            subscription_info=subscription,

            data=json.dumps(
                payload,
                ensure_ascii=False
            ),

            vapid_private_key=temp_path,

            vapid_claims={
                "sub": f"mailto:{NTU_EMAIL}"
            },

            ttl=86400,

            timeout=30
        )

    finally:

        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


def main():

    state = load_state()

    seen = set(
        state["seen_uids"]
    )

    mailbox = poplib.POP3_SSL(
        HOST,
        PORT,
        timeout=30
    )

    try:

        mailbox.user(USERNAME)

        mailbox.pass_(
            NTU_PASSWORD
        )

        _, uidl_lines, _ = mailbox.uidl()

        pairs = []

        for line in uidl_lines:

            parts = (
                line
                .decode(
                    "ascii",
                    errors="replace"
                )
                .split()
            )

            if len(parts) >= 2:

                pairs.append(
                    (
                        int(parts[0]),
                        parts[1]
                    )
                )

        current_uids = [
            uid
            for _, uid in pairs
        ]

        # First successful run:
        # record existing mail without notifying.
        if not state["initialized"]:

            save_state(
                current_uids
            )

            print(
                f"Baseline created with "
                f"{len(current_uids)} "
                f"existing messages. "
                f"No notification sent."
            )

            return

        new_pairs = [
            (number, uid)

            for number, uid
            in pairs

            if uid not in seen
        ]

        if not new_pairs:

            if (
                current_uids
                != state["seen_uids"]
            ):

                save_state(
                    current_uids
                )

            print(
                "No new NTU mail."
            )

            return

        messages = [
            get_header(
                mailbox,
                number
            )

            for number, _
            in new_pairs
        ]

        # Push first.
        # Only save as seen if push succeeds.
        send_push(
            messages
        )

        save_state(
            current_uids
        )

        print(
            f"Sent one push notification "
            f"for {len(messages)} "
            f"new message(s)."
        )

    finally:

        try:
            mailbox.quit()

        except Exception:
            pass


if __name__ == "__main__":
    main()
