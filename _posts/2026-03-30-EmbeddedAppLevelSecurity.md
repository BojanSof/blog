---
title: Application-level security protocol for embedded devices
date: 2026-03-30
categories: [Embedded Systems, Software, Firmware]
tags: [embedded, software, firmware, security, transport]
math: true
image:
  path: /assets/img/mbedappsec/cover.webp
---

While developing embedded applications, there will inevitably be a need to implement a security protocol to protect the data the device shares over a transport protocol, such as Bluetooth Low Energy (BLE), Serial (UART), or TCP/IP.

In this blog post, we are going to explore how to implement an **application-level security protocol**, which protects data sent from an embedded device on a true end-to-end basis.

## Communication Protocol Security

Before diving into application-level security, let's explore the baseline security features that standard communication protocols provide.

Some protocols, especially wired ones like Serial (UART) or USB, do not have any built-in security features by design.
Trust is inherently assumed because data transmission requires physical access to the lines.
However, with cheap hardware like logic analyzers and open-source sniffing software, an attacker with brief physical access can easily dump and read raw USB or UART payloads.

Wireless protocols like Bluetooth Low Energy feature native cryptographic mechanisms designed to secure data while it is in transit over the air.
Similarly, protocols like TLS (Transport Layer Security) sit on top of TCP (Transmission Control Protocol) to provide robust data encryption and authentication for network traffic.

### Why "Securing the Pipe" Is Not Enough

While TLS and similar transport protocols are highly secure, they only encrypt the "pipe" through which data is transferred, not the data itself.
This creates an architectural limitation: data is encrypted *only* during transit.

> **The Transport Layer Blindspot:** Data must be decrypted by the communication stack at the endpoint before it can be handed over to the receiving application.
> This means the data exists as completely unencrypted plaintext in the device's system memory both immediately before transmission and immediately after reception.
{: .prompt-warning }

### Bluetooth Low Energy (BLE)

Because BLE is a highly popular, low-power, and widely used protocol, we will focus on its security features.
We will also use BLE to demonstrate the practical implementations later in this post.

BLE security features rely on a dual process of pairing and bonding:

* **Pairing:** A temporary, real-time process where two communicating devices exchange their supported security capabilities, authenticate one another, and generate a short-lived encryption key to secure the active connection.
* **Bonding:** A process that occurs immediately after pairing.
The devices store the generated cryptographic keys in non-volatile memory.
This allows them to reconnect securely in the future without repeating the entire pairing handshake.

> This post focuses exclusively on **LE Secure Connections (LESC)** introduced in BLE 4.2.
> We will ignore LE Legacy Connections, which rely on easily cracked custom key exchange mechanisms.
{: .prompt-info }

The BLE pairing process happens in three distinct phases:

#### Phase 1: Exchanging Security Features

The two devices exchange their hardware profiles and security requirements:

* **Authentication Requirements:** Is Man-in-the-Middle (MitM) protection required?
Is bonding requested for future sessions?
* **I/O Capabilities:** Does the device have a keyboard, a display, or no user interface at all ("No Input No Output")?
* **Out-of-Band (OOB) Support:** Can the devices communicate over a secondary protocol, such as NFC?

#### Phase 2: Key Generation and Authentication

The devices use **Elliptic Curve Diffie-Hellman (ECDH) P-256** cryptography to establish a secure channel.
Depending on the I/O capabilities declared in Phase 1, the user authenticates the connection using one of four association methods:

* **Just Works:** Used if at least one device lacks a screen and keyboard.
It automatically establishes encryption but offers **no protection** against MitM attacks.
* **Numeric Comparison:** Used if both devices have a display and a simple "yes/no" confirmation mechanism.
Both screens show a matching 6-digit number that the user visually confirms, providing robust MitM protection.
* **Passkey Entry:** One device displays a 6-digit number, and the user manually types it into the opposing device.
* **Out-of-Band (OOB):** The devices exchange authentication data over a different physical medium, such as scanning a printed QR code with a camera or tapping an NFC tag.

Once authenticated, the devices leverage the ECDH shared secret to generate a **Long Term Key (LTK)**, which is used to encrypt the wireless link using **AES-CCM**.

#### Phase 3: Key Distribution

If bonding was requested in Phase 1, the remaining operational keys are distributed over the newly encrypted link:

* **Identity Resolving Key (IRK):** To prevent third parties from tracking a device's physical movements, BLE devices frequently cycle through randomized, temporary MAC addresses.
The IRK allows a trusted, bonded partner to mathematically resolve these changing random addresses back to the device's true static identity.
* **Long Term Key (LTK):** The LTK is written to non-volatile storage on both sides for future use.

At this stage, your communication link is encrypted at the link layer.
Every payload is encrypted by the BLE network stack of the sending device and automatically decrypted by the BLE stack of the receiving device.

---

### Where BLE Security Falls Short

LESC pairing protects data over the air, but stops protecting it once the wireless packet reaches the host operating system.

On a smartphone or tablet, the BLE data delivered to your application has **already been stripped of its BLE encryption layers**.
This creates several security risks:

#### 1. Total Dependency on the OS Stack

Decryption happens inside the operating system's Bluetooth daemon (Android's *BlueDroid* or iOS's *CoreBluetooth*).
If an attacker exploits a vulnerability in the OS or Bluetooth driver, they can capture the decrypted data before it reaches your application.

#### 2. Rogue SDKs and Malicious Apps

Many applications request Bluetooth permissions.
If a user installs an app with a compromised advertising SDK, that software can connect to your device or hook into system services to read unencrypted data meant for your app.

#### 3. The Untrusted Host Environment

Consider a **BLE wearable** tracking sensitive biometric data paired with a user's smartphone.

* **Relying only on BLE security:** The wearable encrypts data over the air.
The smartphone's OS decrypts the packet and places plaintext in system memory.
A background process with Bluetooth permissions could sniff the data and leak it.
* **Adding Application-Level Security:** The wearable encrypts biometric data in firmware using an application-specific key before sending it to the BLE stack.
The phone receives it, strips the BLE layer, and passes ciphertext to the app.
Only your authorized application has the key to decrypt it.
To the rest of the phone, the data is gibberish.

## Cryptography Basics Overview

Before defining our application-level architecture, it helps to briefly understand the cryptographic primitives making it possible.

* **Symmetric Encryption (e.g., AES):** In [symmetric cryptography](https://en.wikipedia.org/wiki/Symmetric-key_algorithm), the same key is used to both encrypt and decrypt the data.
It is highly efficient and easily hardware-accelerated, making it ideal for encrypting large amounts of data on constrained embedded systems.
The challenge, however, is securely sharing this single key between two devices over an untrusted network.
* **Asymmetric Encryption (e.g., ECC):** Also known as [public-key cryptography](https://en.wikipedia.org/wiki/Public-key_cryptography), this uses a pair of mathematically linked keys: a **Public Key** (which can be safely shared with anyone) and a **Private Key** (kept strictly secret).
While solving the key distribution problem, asymmetric encryption is computationally heavy and too slow for real-time data streaming.
* **Elliptic Curve Diffie-Hellman (ECDH):** [ECDH](https://en.wikipedia.org/wiki/Elliptic-curve_Diffie%E2%80%93Hellman) is an anonymous key agreement protocol.
It allows two parties, each having an elliptic-curve public-private key pair, to mathematically compute a shared secret over an insecure channel.
Even if an attacker monitors every byte sent between the two devices during the handshake, they cannot compute the resulting shared secret.
* **Key Derivation Function (KDF):** The shared secret generated by ECDH is highly secure, but its bits are not uniformly random, meaning it shouldn't be used directly as an encryption key.
A [KDF](https://en.wikipedia.org/wiki/Key_derivation_function) acts as a cryptographic mixer.
It takes the ECDH shared secret, adds salt or context parameters, and hashes it to output a cryptographically strong, symmetric session key ready for AES encryption.

## Application-Level Security Protocol

To mitigate the risk of transport-layer compromises, developers can implement application-level security.
By protecting data before it ever reaches the network transport layer, the system achieves true end-to-end security between the embedded hardware and the companion application.
While this approach introduces implementation challenges and additional development overhead, if done right, it provides a robust way of protecting sensitive data.

The core principle is straightforward: encrypt the data payload at the application layer on the transmitting side before handing it off to the transport protocol, and decrypt it only when it reaches the application layer of the receiving side.
The following figure illustrates the protocol.

![Protocol description](/assets/img/mbedappsec/protocol.svg)
*Application-level protocol flow diagram*

We will describe the key cryptographic infrastructure, the end-to-end flow, and then carry on with code examples of how to achieve each step of the flow.
We will conclude with demo firmware for the Nordic nRF54L15 development kit and its accompanying application.

### Key Cryptographic Infrastructure

The protocol depends on 4 cryptographic keys and a certificate signed by a Certificate Authority (CA), described in the following table.

| Key / Component | Embedded Device Role | Client Application Role |
| :--- | :--- | :--- |
| **Identity Keypair** | Holds a unique **Device Private Key (d_s)** generated via Elliptic Curve Cryptography (ECC). | Holds a unique **Application Private Key (d_a)**, ideally generated securely at runtime. |
| **Digital Certificate** | Contains the **Device Public Key (Q_s)**, signed by the Certificate Authority (CA). | Contains the **Application Public Key (Q_a)**, signed by the CA via an API call or deployment pipeline. |
| **Trust Anchor** | Stores the **CA Public Key** to authenticate incoming application connections. | Stores the **CA Public Key** to authenticate the connected embedded device. |
| **Ephemeral Keypair** | Generates a temporary keypair per session for the initial handshake. | Generates a temporary keypair per session for the initial handshake. |
| **Session Key** | Derives a symmetric key (e.g., AES-GCM 256) to encrypt/decrypt data. | Derives the identical symmetric key to encrypt/decrypt data. |

### The End-to-End Security Lifecycle

The lifecycle of establishing a secure context, mutually authenticating, and transmitting data follows a four-step pipeline:

#### 1. Provisioning & Deployment (Preparation Phase)

* **Device Side:** During manufacturing, each embedded device is flashed offline with its unique private identity key (`d_s`) and its CA-signed digital certificate.
The CA Public Key (Trust Anchor) is also burned into the device's non-volatile memory.
* **Application Side:** The companion app is deployed with the same CA Public Key (Trust Anchor).
However, rather than hardcoding static identity keys into the app binary, the app generates its own identity keypair upon installation or first boot using the host platform's hardware security.

#### 2. Connection & Ephemeral Key Exchange (Handshake Phase)

* When the embedded device and the app establish a physical or wireless network connection, they immediately perform an Elliptic Curve Diffie-Hellman (ECDH) exchange.
* Both sides generate temporary, short-lived ephemeral keys to establish a transient, encrypted channel.
This protects the subsequent authentication exchange from eavesdropping.

#### 3. Mutual Authentication (Trust Phase)

* Operating over the temporary encrypted channel, the device and the app swap their respective digital certificates.
* Each side uses its local copy of the Trust Anchor (CA Public Key) to verify the digital signature on the opposing party's certificate.
* To prove actual ownership of the certificates, both parties must successfully sign and verify a cryptographic challenge using their respective private identity keys.

#### 4. Session Key Derivation & Data Encryption (Operational Phase)

* Once mutual authentication succeeds, both the device and the app execute a key derivation function (KDF) using the shared secret from the ECDH step.
This yields a symmetric **Session Key**.
* When the device needs to transmit data, it packages the raw payload, generates a unique **Nonce**, and uses **AES-GCM 256** to create a ciphertext and an authentication tag.
* The final payload is transmitted as: **Nonce + Ciphertext + Tag**.
The app receives this package, verifies the tag for integrity, and decrypts the ciphertext using the same session key.
* The app and device can change roles; the underlying principles remain the same.

### Code examples

To illustrate the separate steps of the described end-to-end flow, we will use the [mbedTLS](https://github.com/Mbed-TLS/mbedtls) library ([release 4.1.0](https://github.com/Mbed-TLS/mbedtls/tree/mbedtls-4.1.0)) and provide few C++ code examples using it.
The code is available on [GitHub](https://github.com/BojanSof/embedded-protocol-security).

#### Generating certs/keys (mini CA)

We will "simulate" the CA using simple Python script that uses the [`cryptography`](https://cryptography.io/en/latest/) python library.
The script is called `mini_ca`, and it can generate the ECC keypairs and generate the signed certificates.

```python
import argparse
import datetime
import os
import sys
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend

# Supported Elliptic Curves
SUPPORTED_CURVES = {
    "secp256r1": ec.SECP256R1(),  # NIST P-256 (default)
    "secp384r1": ec.SECP384R1(),  # NIST P-384
    "secp521r1": ec.SECP521R1(),  # NIST P-521
}


class CertificateAuthorityCLI:
    def __init__(self, out_dir="."):
        self.out_dir = out_dir
        os.makedirs(self.out_dir, exist_ok=True)

    def init_ca(self, common_name, curve_name, days):
        """Initializes a new Root Certificate Authority."""
        print(f"[*] Initializing CA: '{common_name}' using {curve_name}...")
        curve = SUPPORTED_CURVES.get(curve_name.lower())

        ca_key = ec.generate_private_key(curve, default_backend())

        subject = issuer = x509.Name(
            [
                x509.NameAttribute(NameOID.COMMON_NAME, common_name),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Device Network"),
            ]
        )

        ca_cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
            .not_valid_after(
                datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(days=days)
            )
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=None),
                critical=True,
            )
            .sign(ca_key, hashes.SHA256(), default_backend())
        )

        self._save_to_disk("ca", ca_key, ca_cert)
        print(
            "[+] CA Initialized successfully. (Files: ca_key.pem, ca_cert.pem, ca_cert.der)"
        )

    def issue_cert(
        self, name, ca_cert_path, ca_key_path, curve_name, days, pub_key_path=None
    ):
        """Generates a new keypair OR signs an existing public key."""
        print(f"[*] Issuing identity for '{name}'...")

        # 1. Load the CA Key and Cert
        try:
            with open(ca_key_path, "rb") as f:
                ca_key = serialization.load_pem_private_key(
                    f.read(), password=None, backend=default_backend()
                )
            with open(ca_cert_path, "rb") as f:
                ca_cert = x509.load_pem_x509_certificate(f.read(), default_backend())
        except FileNotFoundError as e:
            print(
                f"[!] Error: Could not load CA files. Make sure to run 'init' first. ({e})"
            )
            sys.exit(1)

        # 2. Determine Public Key (Load existing vs Generate new)
        device_key = None
        if pub_key_path:
            print(f"[*] Using provided public key from: {pub_key_path}")
            try:
                with open(pub_key_path, "rb") as f:
                    public_key = serialization.load_pem_public_key(
                        f.read(), default_backend()
                    )
            except Exception as e:
                print(f"[!] Error loading public key: {e}")
                sys.exit(1)
        else:
            print(f"[*] Generating new {curve_name} keypair...")
            curve = SUPPORTED_CURVES.get(curve_name.lower())
            device_key = ec.generate_private_key(curve, default_backend())
            public_key = device_key.public_key()

        # 3. Build and Sign the Certificate
        subject = x509.Name(
            [
                x509.NameAttribute(NameOID.COMMON_NAME, name),
            ]
        )

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(ca_cert.subject)
            .public_key(
                public_key  # Use the loaded or generated public key
            )
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
            .not_valid_after(
                datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(days=days)
            )
            .sign(ca_key, hashes.SHA256(), default_backend())
        )

        # 4. Save to disk
        base_path = os.path.join(self.out_dir, name)

        # Only save private key if we generated it locally
        if device_key:
            with open(f"{base_path}_key.pem", "wb") as f:
                f.write(
                    device_key.private_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PrivateFormat.PKCS8,
                        encryption_algorithm=serialization.NoEncryption(),
                    )
                )

        # Always save the certificates
        with open(f"{base_path}_cert.pem", "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(f"{base_path}_cert.der", "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.DER))

        print(
            f"[+] Identity '{name}' issued successfully. (Files: {name}_cert.pem/der)"
        )

    def _save_to_disk(self, prefix, key, cert):
        """Helper for the init_ca function to save Root CA files."""
        base_path = os.path.join(self.out_dir, prefix)

        with open(f"{base_path}_key.pem", "wb") as f:
            f.write(
                key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption(),
                )
            )

        with open(f"{base_path}_cert.pem", "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

        with open(f"{base_path}_cert.der", "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.DER))


def main():
    parser = argparse.ArgumentParser(
        description="Local Certificate Authority Simulator for Embedded Devices"
    )
    subparsers = parser.add_subparsers(
        dest="command", help="Available commands", required=True
    )

    # Global options
    parser.add_argument(
        "--out-dir",
        default="certs",
        help="Directory to output generated files (default: ./certs)",
    )

    # Command: init
    init_parser = subparsers.add_parser("init", help="Initialize a new Root CA")
    init_parser.add_argument(
        "--name", default="Local Root CA", help="Common Name for the CA"
    )
    init_parser.add_argument(
        "--curve",
        choices=SUPPORTED_CURVES.keys(),
        default="secp256r1",
        help="Elliptic Curve to use",
    )
    init_parser.add_argument(
        "--days",
        type=int,
        default=3650,
        help="Validity period in days (default: 10 years)",
    )

    # Command: issue
    issue_parser = subparsers.add_parser(
        "issue", help="Issue a new device/client certificate"
    )
    issue_parser.add_argument(
        "name", help="Name for the new identity (e.g., Device_001, Mobile_App_V1)"
    )
    issue_parser.add_argument(
        "--ca-cert", default="certs/ca_cert.pem", help="Path to CA certificate"
    )
    issue_parser.add_argument(
        "--ca-key", default="certs/ca_key.pem", help="Path to CA private key"
    )
    issue_parser.add_argument(
        "--curve",
        choices=SUPPORTED_CURVES.keys(),
        default="secp256r1",
        help="Elliptic Curve to use",
    )
    issue_parser.add_argument(
        "--days",
        type=int,
        default=365,
        help="Validity period in days (default: 1 year)",
    )
    issue_parser.add_argument(
        "--pub-key",
        help="Path to an existing PEM public key to sign (skips private key generation)",
    )

    args = parser.parse_args()
    cli = CertificateAuthorityCLI(out_dir=args.out_dir)

    if args.command == "init":
        cli.init_ca(args.name, args.curve, args.days)
    elif args.command == "issue":
        cli.issue_cert(
            args.name, args.ca_cert, args.ca_key, args.curve, args.days, args.pub_key
        )


if __name__ == "__main__":
    main()
```
{: file='mini_ca.py'}

To use the `mini_ca`, one first needs to initialize it and this is when the CA keypair is generated.
After that, it is possible to generate as many keys and certificates as needed, by providing device ID:

```bash
python mini_ca.py init  # creates the CA keypair
python mini_ca.py issue dev01  # create keypair and signed cert for device with ID dev01
python mini_ca.py issue app --pub-key "app_key.pem"  # create signed cert for application (public key comes from app)
```
{: file='mini_ca.py usage'}

#### ECDH key exchange

Before transferring any kind of data or doing any authentication, we can create a temporary encrypted link.
The ECDH exchange allows deriving a shared secret between two parties over an insecure link.

The devices generate temporary key pairs (called Ephemeral keys) and exchange the public keys over the insecure link.
The devices can use their private keys and multiply them with the received public keys to derive a shared secret.

The shared secret can be passed to a key derivation function to derive a symmetric cryptography key used to encrypt the link.
This key can be used while the authentication phase lasts, then it can be destroyed and a new session key can be derived once authentication is passed.
More on this later.

```cpp
// Ephemeral key attributes
psa_key_attributes_t ecdhAttr = PSA_KEY_ATTRIBUTES_INIT;
psa_set_key_usage_flags(&ecdhAttr, PSA_KEY_USAGE_DERIVE);
psa_set_key_algorithm(&ecdhAttr, PSA_ALG_ECDH);
psa_set_key_type(&ecdhAttr, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
psa_set_key_bits(&ecdhAttr, 256);

// Generate the ephemeral keys
PsaKey appEphemeralKey;
PsaKey fwEphemeralKey;

if (psa_generate_key(&ecdhAttr, appEphemeralKey.get_ptr()) != PSA_SUCCESS
  || psa_generate_key(&ecdhAttr, fwEphemeralKey.get_ptr()) != PSA_SUCCESS)
{
  return 1;
}

// Export public keys, simulating exchange
uint8_t appPubBytes[PSA_EXPORT_PUBLIC_KEY_MAX_SIZE];
size_t appPubLen;
psa_export_public_key(appEphemeralKey.get(), appPubBytes, sizeof(appPubBytes), &appPubLen);

uint8_t fwPubBytes[PSA_EXPORT_PUBLIC_KEY_MAX_SIZE];
size_t fwPubLen;
psa_export_public_key(fwEphemeralKey.get(), fwPubBytes, sizeof(fwPubBytes), &fwPubLen);

// Deriving the shared secret
uint8_t appDerivedSecret[PSA_RAW_KEY_AGREEMENT_OUTPUT_MAX_SIZE];
size_t appSecretLen;
uint8_t fwDerivedSecret[PSA_RAW_KEY_AGREEMENT_OUTPUT_MAX_SIZE];
size_t fwSecretLen;

// App side
if (psa_raw_key_agreement(
      PSA_ALG_ECDH,
      appEphemeralKey.get(),  // App's Private Key
      fwPubBytes, fwPubLen,  // Firmware's Public Key
      appDerivedSecret, sizeof(appDerivedSecret), &appSecretLen)
  != PSA_SUCCESS)
{
  return 1;
}

// Device (Firmware) side
if (psa_raw_key_agreement(
      PSA_ALG_ECDH,
      fwEphemeralKey.get(),  // Firmware's Private Key
      appPubBytes, appPubLen,  // App's Public Key
      fwDerivedSecret, sizeof(fwDerivedSecret), &fwSecretLen)
  != PSA_SUCCESS)
{
    return 1;
}
// fwDerivedSecret and appDerivedSecret should match
```
{: file='ecdh_sim.cpp'}

#### Authentication: Certificate verification

mbedTLS has an [X.509](https://en.wikipedia.org/wiki/X.509) module which provides support for reading, writing and verification of certificates.

The certificates include digital signature, which actually represents the hash of the certificate details, encrypted using the CA private key.
The certificate verification is a process in which the Trust Anchor (CA public key) is used to decrypt the digital signature and compare that hash with the hash calculated from the certificate details.
This is the first part of the authentication process, confirming that the certificate is issued by the CA, but doesn't confirm ownership.

```cpp
// load Trust Anchor (CA certificate)
X509Cert caCert;
if (auto ret = mbedtls_x509_crt_parse_file(caCert.get(), "certs/ca_cert.pem"); ret != 0)
{
  return 1;
}
// load other side certificate (app checks dev, dev checks app)
X509Cert comCert;
if (auto ret = mbedtls_x509_crt_parse_file(comCert.get(), "certs/com_cert.pem"); ret != 0)
{
  return 1;
}
// verify the certificate
uint32_t flags{ };
if (auto ret = mbedtls_x509_crt_verify(comCert.get(), caCert.get(), NULL, NULL, &flags, NULL, NULL); ret != 0)
{
  // verification failed
  return 1;
}
```
{: file='auth_cert_verify.cpp'}

#### Authentication: Challenge

With the previous verification step, it is confirmed that the certificates are issued by the CA, but the certificates could be stolen, so ownership is not confirmed.
To confirm ownership, the devices that communicate need to sign a challenge using their device identity keys.
Because they already exchanged the certificates, they have the public keys needed to decrypt the exchanged payload.
The challenge can be the Ephemeral key derived in the ECDH key exchange, the first step.
The challenge is actually encrypting the hash of the Ephemeral key using the device identity key.
Then, each device can use the public key to decrypt the encrypted hash and compare it with the hash they calculated.

```cpp
// the challenge is created from the Ephemeral key
const std::string challengeData = "Ephemeral_Key";

// calculate the hash of the Ephemeral key
uint8_t challengeHash[PSA_HASH_LENGTH(PSA_ALG_SHA_256)];
size_t hashLen;
if (psa_hash_compute(
      PSA_ALG_SHA_256,
      reinterpret_cast<const uint8_t*>(challengeData.data()), challengeData.length(),
      challengeHash, sizeof(challengeHash), &hashLen)
  != PSA_SUCCESS)
{
  return 1;
}

// sign the challenge (assume device identity key is imported by PSA)
uint8_t signature[PSA_SIGNATURE_MAX_SIZE];
size_t signatureLen;
if (psa_status_t status = psa_sign_hash(
      devIdKey,
      PSA_ALG_ECDSA(PSA_ALG_SHA_256),
      challengeHash, sizeof(challengeHash),
      signature, sizeof(signature), &signatureLen);
  status != PSA_SUCCESS)
{
  return 1;
}

// verify the challenge (assume other side pub key is already imported with PSA)
if (psa_status_t status = psa_verify_hash(
    otherDevPubKey,
    PSA_ALG_ECDSA(PSA_ALG_SHA_256),
    challengeHash, sizeof(challengeHash),
    signature, signatureLen);
  status != PSA_SUCCESS)
{
  // verification failed
  return 1;
}
```
{: file='auth_cert_challenge.cpp'}

#### Session key derivation

After the authentication phase, the devices need to derive a key for symmetric encryption.
This is done on the shared ECDH exchange secret, by running it through a key derivation function (KDF).

```cpp
// ECDH secret
const uint8_t rawEcdhSecret[32]
  = { 0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27 };
// HKDF: DERIVING THE AES-256 SESSION KEY
// Context info prevents keys from being reused
const std::string hkdfInfo = "SESSION_V1";
psa_key_attributes_t baseSecretAttr = PSA_KEY_ATTRIBUTES_INIT;
psa_set_key_type(&baseSecretAttr, PSA_KEY_TYPE_DERIVE);
psa_set_key_usage_flags(&baseSecretAttr, PSA_KEY_USAGE_DERIVE);
psa_set_key_algorithm(&baseSecretAttr, PSA_ALG_HKDF(PSA_ALG_SHA_256));

PsaKey baseSecretKey;
if (psa_import_key(&baseSecretAttr, rawEcdhSecret, sizeof(rawEcdhSecret), baseSecretKey.get_ptr()) != PSA_SUCCESS)
{
  return 1;
}
// Setup the AES-256 Key Attributes
psa_key_attributes_t aesAttr = PSA_KEY_ATTRIBUTES_INIT;
psa_set_key_type(&aesAttr, PSA_KEY_TYPE_AES);
psa_set_key_bits(&aesAttr, 256);
// This key is ONLY allowed to do AES-GCM encryption and decryption
psa_set_key_usage_flags(&aesAttr, PSA_KEY_USAGE_ENCRYPT | PSA_KEY_USAGE_DECRYPT);
psa_set_key_algorithm(&aesAttr, PSA_ALG_GCM);
// Run the HKDF Operation
PsaKey sessionKey;
psa_key_derivation_operation_t hkdfOp = PSA_KEY_DERIVATION_OPERATION_INIT;
if (auto ret = psa_key_derivation_setup(&hkdfOp, PSA_ALG_HKDF(PSA_ALG_SHA_256)); ret != PSA_SUCCESS)
{
  return 1;
}
// PSA automatically applies the spec-compliant HashLen zero-salt.
if (auto ret = psa_key_derivation_input_key(&hkdfOp, PSA_KEY_DERIVATION_INPUT_SECRET, baseSecretKey.get()); ret != PSA_SUCCESS)
{
  return 1;
}
if (auto ret = psa_key_derivation_input_bytes(
      &hkdfOp,
      PSA_KEY_DERIVATION_INPUT_INFO,
      reinterpret_cast<const uint8_t*>(hkdfInfo.data()), hkdfInfo.length());
    ret != PSA_SUCCESS)
{
  return 1;
}
if (auto ret = psa_key_derivation_output_key(&aesAttr, &hkdfOp, sessionKey.get_ptr()); ret != PSA_SUCCESS)
{
  return 1;
}
psa_key_derivation_abort(&hkdfOp);  // Clean up the HKDF context
```
{: file='session_encrypt.cpp'}

#### Data encryption and decryption

Now it is possible to use the derived session key on both sides for encryption and decryption.
AES-GCM is a good choice as an algorithm for symmetric cryptography, which also includes authentication data.
Encryption by itself hides the data, but it doesn't guarantee that someone hasn't tampered with it.
For this reason, methods like AES-GCM, called Authenticated Encryption with Associated Data (AEAD), provide data confidentiality and authentication, guaranteeing that the data comes from a trusted source.

AES-GCM is an algorithm which can be parallelized compared to older methods, and many devices include hardware acceleration for it.
When using AES-GCM, besides the encrypted payload, there is a need to send a Nonce (Number used Once) and an Authentication Tag.

The nonce is required to introduce randomness, making the same payload appear different when encrypted, as it is mixed with it before the actual encryption.
The nonce can be a random number generated using the True Random Number Generator (TRNG) module of the hardware, but typically it should be a mix of a random number and some counter, which can be a timestamp for example of some event.

The authentication tag is used for authentication purposes.
The crypto engine uses the nonce and the encrypted data to derive a tag, and compares this tag with the authentication tag.
If for some reason they don't match, the data has been tampered with and should be discarded.

```cpp
// ENCRYPTION
const std::string data = "{\"x\": 14, \"y\": -2}";

const uint32_t timestamp = 1779647356;
static uint64_t ramMessageCounter = 0;

uint8_t packetNonce[12];
// Pack 4-byte timestamp
packetNonce[0] = (timestamp >> 24) & 0xFF;
packetNonce[1] = (timestamp >> 16) & 0xFF;
packetNonce[2] = (timestamp >> 8)  & 0xFF;
packetNonce[3] = timestamp         & 0xFF;

// Pack 8-byte RAM counter (Big-Endian)
for (int i = 0; i < 8; ++i) {
    packetNonce[4 + i] = (ramMessageCounter >> (56 - (i * 8))) & 0xFF;
}

// The output buffer must be large enough to hold the Plaintext + the 16-byte Authentication Tag
std::vector<uint8_t> ciphertext(PSA_AEAD_ENCRYPT_OUTPUT_SIZE(PSA_KEY_TYPE_AES, PSA_ALG_GCM, data.length()));
size_t ciphertextLen = 0;

// Encrypting payload
if (psa_aead_encrypt(
      sessionKey.get(),
      PSA_ALG_GCM,
      packetNonce, sizeof(packetNonce),
      nullptr,
      0,  // Additional Data
      reinterpret_cast<const uint8_t*>(data.data()), data.length(),
      ciphertext.data(), ciphertext.size(), &ciphertextLen)
    != PSA_SUCCESS)
{
  return 1;
}

// DECRYPTION
// The output buffer just needs to be the size of the ciphertext (it will shrink)
std::vector<uint8_t> decryptedData(ciphertextLen);
size_t decryptedLen = 0;

// PSA decryption automatically verifies the 16-byte GCM Tag embedded at the end of the ciphertext.
// If a hacker flips a single bit in the ciphertext, this function immediately returns PSA_ERROR_INVALID_SIGNATURE.
if (psa_aead_decrypt(
      sessionKey.get(),
      PSA_ALG_GCM,
      packetNonce, sizeof(packetNonce),
      nullptr,
      0,  // Additional Data
      ciphertext.data(), ciphertextLen,
      decryptedData.data(), decryptedData.size(), &decryptedLen)
    != PSA_SUCCESS)
{
  return 1;
}

```
{: file='session_encrypt.cpp'}

### Practical Full-Fledged Demo

We use the nRF54L15 development kit to demonstrate the firmware side of the application protocol.
The nRF54L15 operates as a single-core MCU where both the Bluetooth controller and application run on the same core.
A companion Python application acts as the host client.
The code is available on [GitHub](https://github.com/BojanSof/embedded-protocol-security).

> The mobile app side—Android and iOS—is not covered here, but documentation exists for implementing the cryptographic functions on those platforms.
{: .prompt-info}

### Embedded Device Side

The firmware is a Zephyr RTOS application that establishes an encrypted tunnel over a standard BLE connection, using the nRF Connect SDK.

#### Fail-Closed Provisioning

We generate the keys on the local Certificate Authority and inject them during first boot.

A dedicated staging partition (`provisioning-staging`) holds a custom TLV blob containing the device identity key and certificates during initial flashing.

The device parses this blob during `SYS_INIT`, before the BLE stack starts advertising:

1. Validates the blob header with a CRC32 check.
2. Extracts the EC private key and imports it into the PSA subsystem as a persistent, hardware-locked key.
3. Reads the Root CA and Device Certificates, saving them in Zephyr Memory Subsystem (ZMS).
4. **Erases the staging partition entirely** — a burn-after-reading mechanism.
Whether parsing succeeds or fails, the staging partition is wiped.
This prevents a compromised device from leaking its provisioning data.

#### Application Fragmentation

Standard BLE characteristics cannot handle large payloads like 512-byte X.509 certificates.
The firmware implements a manual fragmentation protocol at the application layer.

Packets are chunked to fit within the negotiated ATT MTU limit (up to 244 bytes):

* The first fragment has a 3-byte header with the BLE Topic and total payload length.
* Every subsequent chunk is prefixed with a `0x00` continuation marker.

If a packet drops or a marker is misaligned, the assembler resets its buffer instead of trying to recover.
This prevents memory overflows and forces the client to retry.

#### Security FSM

An event-driven Security Finite State Machine (`SecurityFsm`) drives the protocol.
The BLE server acts as a pass-through, pushing raw bytes into an asynchronous queue (`emPub`) so the FSM processes data without blocking the controller.

The connection lifecycle follows these states:

| State | Protocol Action | Cryptographic Operation |
| --- | --- | --- |
| **TEMP_KEY_EXCHANGE** | Both peers exchange ephemeral ECDH public keys in plaintext. | Derives a temporary AES-128-GCM key for the handshake. |
| **UNAUTHENTICATED** | Client sends its certificate over the encrypted temporary session. | Device verifies the app certificate against the Root CA. |
| **EXCHANGING_CERTS** | Device sends its certificate; both sides exchange new ephemeral keys and nonces. | Device signs nonces and keys with ECDSA to prove possession of the private key. |
| **AUTHENTICATED** | Temporary session is destroyed; bidirectional secure communication begins. | Final AES-256-GCM session key derived via HKDF-SHA-256. |

**Reflection Defense:**
To prevent replay and reflection attacks, AES-GCM Additional Authenticated Data (AAD) binds ciphertext to a specific context.

During the handshake, the 1-byte BLE Command Topic is the AAD.
This prevents an attacker from replaying an encrypted certificate as a handshake payload.
After authentication, directional enumerators serve as the AAD (`AppToDevice = 0x00`, `DeviceToApp = 0x01`).
If an attacker captures and replays a packet back to its sender, the GCM tag matches but the directional AAD causes decryption to fail.

#### PSA Crypto

The nRF Connect SDK integrates with the Platform Security Architecture (PSA) Crypto API, keeping raw key material out of application RAM.

Ephemeral keys have locked-down usage policies (derivation and export only).
When the final AES-256-GCM session key is derived via HKDF, it briefly sits in a temporary RAM buffer before import into a PSA hardware slot.
After import, the buffer is zeroed out.

### Python Application

The repository includes two Python utilities that serve as the host-side counterparts.

**Provisioning Builder (`create_provisioning_blob.py`)**
Takes the PEM/DER cryptographic files from the CA and packs them into the TLV binary format the firmware expects.
Calculates CRC32 headers and outputs an Intel HEX file that merges with the Zephyr firmware at the `0x15C000` staging address.

**Interactive Test Client (`ble_test_cli.py`)**
Standard tools cannot test application-layer encrypted BLE devices because payloads look like random data.
This cross-platform async CLI uses `bleak` and the Python `cryptography` library.

The client provides an interactive prompt to:

* Scan and connect to the secure peripheral.
* Handle application-layer ATT MTU fragmentation and reassembly.
* Execute the mirrored cryptographic handshake (ECDH, X.509 validation, AES-GCM).
* Send and receive plaintext messages that are encrypted before transmission.

## Conclusion

The implementation of an application-level security protocol is a critical investment for any embedded system that handles sensitive data.
By moving the boundary of trust from the hardware transport layer to the application layer, we effectively eliminate the "Transport Layer Blindspot."
This ensures that data remains encrypted even when processed by potentially vulnerable operating systems or intercepted by malicious background applications.

While implementing such a protocol—including secure provisioning, ephemeral key exchanges, and manual data fragmentation—demands significant architectural rigor, the outcome is a robust, truly end-to-end secure communication channel.
As embedded devices continue to evolve into sophisticated nodes within a broader digital ecosystem, the move toward application-layer security is no longer an optional feature; it is an essential foundation for long-term device integrity and user trust.
