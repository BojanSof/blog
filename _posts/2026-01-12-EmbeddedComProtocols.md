---
title: Communication protocols for embedded devices
date: 2026-01-12
categories: [Embedded Systems, Software, Firmware]
tags: [embedded, software, firmware, protocol, communication, serialization, framing]
math: false
image:
  path: /assets/img/mbedcom/cover.webp
---

One of the crucial tasks that embedded devices often need to do is communicate with another device.
It is up to the engineer to choose how physically the devices will connect, how the bits will be timed and formatted and how the user data will be structured in those bits.
The goal of this blog post is to mainly cover the last point - how to structure the user data, going deeper into the options for serialization and framing.

## Communication protocol stack

The communication protocols can be modelled with stack with multiple layers, very similar to how [TCP/IP](https://en.wikipedia.org/wiki/Internet_protocol_suite#Key_architectural_principles) and [BLE](https://www.bluetooth.com/bluetooth-le-primer/#mcetoc_1iiprfme58) protocol stacks are defined.
We will use the term *message* to describe the payload that is exchanged in the communication.

- Application Layer
- Presentation Layer
- Framing Layer
- Data Link Layer
- Physical layer

![Communication protocol stack](/assets/img/mbedcom/stack.svg){: .light}
![Communication protocol stack](/assets/img/mbedcom/stack-dark.svg){: .dark}
_Communication protocol stack_

We will describe the layers going from the top to the bottom.
On top of the stack is the **Application Layer** which represents the business logic, represented by high-level abstract objects.
Below it is the **Presentation Layer**, which handles the serialization of the data, by converting the high-level abstract objects into a raw byte array.
Next is the **Framing Layer**, with goal of ensuring that the receiving side knows where the message begins and ends.
The **Data Link Layer** follows next, which handles the transmission logic, and on the bottom of the stack is the **Physical Layer** which uses the laws of the physics to drive the communication medium.

### Example for communication protocol stack

We can illustrate the layers using simple example of having a temperature and humidity measuring device as the sender and computer as the receiver, connected via [RS-232](https://en.wikipedia.org/wiki/RS-232) - not choosing USB due to increased complexity for the example.
On the application layer we have the abstract high-level object containing the measured temperature and humidity, represented using the following C structure:

```c
struct SensorData {
    float temperature;  // 24.5 deg C
    uint8_t humidity;  // 51%
}
```

In the presentation layer, this high-level object is converted into a raw byte array.
We can use quite simple format in which we will represent the temperature using 4-bytes (for example [IEEE 754 format](https://en.wikipedia.org/wiki/IEEE_754)), and the humidity is represented with single byte, using little-endian byte-ordering:

```
[0x00, 0x00, 0xc4, 0x41, 0x33]

25.4 = 0x41c40000 IEEE 754
51 = 0x33
```

Although in this trivial case each message is fixed length and framing may not be necessary, for completeness we'll show framing so receivers can find message boundaries.
In the framing layer for this example we can use [COBS (Consistent Overhead Byte Stuffing)](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing). Essentially, COBS replaces zero bytes in the payload with non-zero markers that indicate the distance to the next zero or to the end of the packet:
```
[0x01, 0x01, 0x04, 0xc4, 0x41, 0x33, 0x00]
```

On the data link layer, the [UART](https://en.wikipedia.org/wiki/Universal_asynchronous_receiver-transmitter) controller of the device adds start, stop and parity bits to each byte of the packet, to get the final bit stream (we use [8N1 format](https://en.wikipedia.org/wiki/Serial_port#Conventional_notation)):
```
0100000001 0100000001 0001000001 0001000111 0100000101 0110011001 0000000001
```

Finally, this bit stream is converted to appropriate voltage levels with correct timing, depending on the used baud rate for the communication.
If we use baud rate of 9600, then each bit has duration of 1/9600 ≈ 104 us, bit 0 is represented with voltage level between 5 V and 15 V in RS-232, while bit 1 is represented with voltage level between -15 V and -5 V.

The receiving side performs the inverse steps in reverse layer order.

In this blog post we are going to take a deeper look at the presentation and framing layers, or to be more precise we will look at some options for the **serialization** and **framing** of the data.

## Presentation layer - Serialization

In order to be able to transmit the data stored in the high-level objects in the application layer, we need a way to convert the high-level object data into stream of bytes, or we need to [**serialize**](https://en.wikipedia.org/wiki/Serialization) it.
Serialization is also used to convert the data not just for transmitting purposes, but also for storing purposes.

There are popular serialization formats used very often during development, like JSON, YAML, Protocol Buffers, etc., each having their application based on pros and cons.
We can categorize the serialization formats using multiple categories:
- *human readability*, how easy can humans understand the serialized data, which is closely related to towards which of the human or machine the formats are optimized for,
- *compactness*, how small is the serialized data,
- *speed*, related to the implementation complexity, how fast the data can be serialized by the device,
- *schema*, the blueprint describing the fields, types and the structure of the data.

The following table lists some of the most famous serialization formats optimized for human readability, often used during embedded system development, along with the listed categories (the difference in the categories is relative between the items in the table):

| Serialization format                                             | Human readability    | Compactness | Schema                     | Best use                        |
| :--------------------------------------------------------------- | :------------------: | :---------: | :------------------------: | :------------------------------ |
| [JSON](https://en.wikipedia.org/wiki/JSON)                       |    ✅ High           |   🔴 Low    | None (Self-describing)    | Web (Cloud, APIs)               |
| [YAML](https://en.wikipedia.org/wiki/YAML)                       |    ✅✅ Excellent    |   🔴 Low    | None (Self-describing)    | Configuration                   |
| [CSV](https://en.wikipedia.org/wiki/Comma-separated_values)      |    ✅ High           |   🟡 Medium | Implicit (Column order)   | Data logging                    |

One of the most prominent serialization formats is JSON, often used to exchange data between devices on network, often clients and servers.
It is dominant in IoT, enabling devices to send data (often sensor data) and receive commands via protocols like [MQTT](https://en.wikipedia.org/wiki/MQTT) and HTTP/[REST APIs](https://en.wikipedia.org/wiki/REST).
CSV format is often used for dumping mainly sensor data to external memory medium, like SD card, for easy retrieval and analysis on computer for example.

For more constrained embedded devices, it is better to use machine optimized serialization formats, which are not human readable, but much more compact then text formats which are optimized for humans.
They often have better serialization and deserialization speeds compared to the human readable formats on the same platforms.
And to deserialize the data, typically the receiving side needs to know the schema of the protocol.
We will cover some of the most used machine optimized serialization formats next.

### Custom binary packing

One of the most common form of serialization is to perform custom binary packing of the fields.
This approach is the most compact form of serialization, in which the developer has total control of how the bytes are used.
Basically, the developer sets the endianness of the data, how many bytes each field occupies, and the order in which fields are serialized.
We need to know all of these things to deserialize the data.

```c
struct SensorData {
  uint64_t timestamp;
  int16_t temperature;
  uint8_t humidity;
};
// high-level data
struct SensorData data = {
  .timestamp = 1768414055,
  .temperature = 24.6,
  .humidity = 51
};
// custom binary serialization, little-endian
uint8_t buffer[11] = {};
buffer[0] = timestamp & 0xFF;
buffer[1] = (timestamp >> 8) & 0xFF;
buffer[2] = (timestamp >> 16) & 0xFF;
buffer[3] = (timestamp >> 24) & 0xFF;
buffer[4] = (timestamp >> 32) & 0xFF;
buffer[5] = (timestamp >> 40) & 0xFF;
buffer[6] = (timestamp >> 48) & 0xFF;
buffer[7] = (timestamp >> 56) & 0xFF;

buffer[8] = temperature & 0xFF;
buffer[9] = (temperature >> 8) & 0xFF;

buffer[10] = humidity;

// custom binary deserialization
struct SensorData deserializedData = {
  .timestamp = (buffer[0]) |
                (buffer[1] << 8) |
                (buffer[2] << 16) |
                (buffer[3] << 24) |
                (buffer[4] << 32) |
                (buffer[5] << 40) |
                (buffer[6] << 48) |
                (buffer[7] << 56),
  .temperature = (buffer[8]) |
                  (buffer[9] << 8),
  .humidity = buffer[10]
};
```
{: file='custom_binary_packing_simple.c'}

If there are nested high-level objects, we can simply ensure that each nested object follows "the contract" - implement serialization method and the top-level object delegates the serialization buffer to each children object.
In case of variable length data, such as arrays, one needs to encode their length too.

The biggest drawback of custom binary packing is schema evolution, meaning adding new fields in the high-level object could break the receiver.
For example, if we have high-level object containing the temperature and humidity values and we add pressure value in between, the receiver having the old data structure would incorrectly parse the bytes.
To resolve this, versioning logic should be added to the serialization protocol, making the receiver side more complicated.

**Pros**:
- Full control over the bytes
- Minimal size
- Maximum performance

**Cons**:
- Potential complex implementation
- Schema evolution issues
- Lack of interoperability and tooling

### Protocol Buffers

[Protocol Buffers (Protobuf)](https://protobuf.dev/) is a free and open-source cross-platform data format used to serialize structured data developed by Google.
Protocol buffers require a schema to describe how the data looks like, described in `.proto` file and then special compiler, called `protoc` will generate the required source file for the target language.
In the background, protobuf uses [Tag-Length-Value (TLV)](https://en.wikipedia.org/wiki/Type%E2%80%93length%E2%80%93value) encoding scheme, which encodes the ID and type of each field (tag), the number of bytes to specify how many bytes consist dynamically sized payload (length) and the payload data (value).
This is what makes protocol buffers backwards compatible, as deserializer can simply skip unknown tags.

```protobuf
syntax = "proto3";

message SensorReading {
  uint64 timestamp = 1;
  float temperature = 2;
  uint32 humidity = 3;
}

message DeviceInfo {
  uint32 deviceID = 1;
  string location = 2;
}

message SensorPacket {
  DeviceInfo info = 1;
  repeated SensorReading readings = 2;
}
```
{: file='schema.proto'}

In protobuf, *message* is the fundamental data structure used to define and exchange structured data.
Each message is composed of multiple typed fields, which can also be another messages.
There are few plain types that can be used for the fields, which use one of the [six wire encodings](https://protobuf.dev/programming-guides/encoding/#structure) to convert the data to the stream of bytes.
One of the core protobuf wire encodings is variable-width integers (varints), which allow to encode integers with variable number of bytes.
The plain types for the fields can be signed and unsigned integers, floating-point numbers, boolean values, arrays and strings with dynamic length.
Protobuf also allows to define enums, which are implemented as integers in the background and unions using `oneof` fields.
If there are missing fields in a message, protobuf will simply leave those fields out.

The official Google protobuf libraries are general-purpose for computing environments with fewer memory constraints, opposed to embedded systems.
For this reason, there is specialized ANSI-C library, called [`nanopb`](https://jpa.kapsi.fi/nanopb/), tailored towards embedded system with memory constraints, featuring [small code size (5-20 kB) and small RAM usage (~ 1 kB)](https://jpa.kapsi.fi/nanopb/docs/index.html#features-and-limitations).
`nanopb` is also available ready to use in [Zephyr RTOS](https://www.zephyrproject.org/) applications.
It is interesting to note that `nanopb` allows to complement the `.proto` schema files with `.options` files which modify the generator options, like maximum size of certain fields (like strings and arrays) in order to allocate the memories for them statically.

### CBOR

[CBOR (Concise Binary Object Representation)](https://cbor.io/) is serialization format loosely based on JSON, allowing to exchange data structured as name-value pairs, but designed to be more efficient and compact.
CBOR support extended set of data types for the fields compared to JSON, which include arbitrary-precision decimal numbers and "big integers", strings, binary data, arrays, maps, native date and time representation and more.

CBOR encoding works in such way that there is initial byte, split in two parts:
- Major Type (MT), the first 3 bytes, determining the field type: integer, string, array, map, etc.
- Additional Information (AI), the next 5 bytes, typically representing the value of the field if it is small enough, or the length of the data that follows.

CBOR is self-describing format, meaning it doesn't require schema like protobuf does.

```cbor
# JSON (size = 57 bytes): {"timestamp":1768414055,"temperature":24.6,"humidity":51}
# CBOR (size = 49 bytes):
A3                           # map(3)
   69                        # text(9)
      74696D657374616D70     # "timestamp"
   C1                        # tag(1), tag for timestamp
      1A 6967DB67            # unsigned(1768414055)
   6B                        # text(11)
      74656D7065726174757265 # "temperature"
   FB 403899999999999A       # primitive(4627617502109211034)
   68                        # text(8)
      68756D6964697479       # "humidity"
   18 33                     # unsigned(51)
```
{: file='example.cbor'}

> There is a CBOR playground, which allows to take a look how CBOR represents data, by providing human-readable data using CBOR Diagnostic Notation, which is basically superset of JSON.
{: .prompt-tip }

### FlatBuffers

[FlatBuffers](https://flatbuffers.dev/) is a cross platform open-source serialization library developed by Google, designed for maximum memory efficiency, allowing to directly access serialized data without parsing it first.
Similarly to protobuf, it requires [schema](https://flatbuffers.dev/schema/) (`.fbs` file) to describe the data, and special compiler, [`flatc`](https://flatbuffers.dev/flatc/), which generates the source code for serialization and deserialization for the targeted language.
FlatBuffers provide great backward compatibility.
The maximum memory efficiency is achieved by utilizing relative offset to point to data.

```flatbuffer
table SensorReading {
  timestamp: ulong;
  temperature: float;
  humidity: uint;
}

table DeviceInfo {
  deviceID: uint;
  location: string;
}

table SensorPacket {
  info: DeviceInfo;
  readings: [SensorReading];
}

root_type SensorPacket;
```
{: file='schema.fbs'}

A *table* is the fundamental data structure used to define objects in flatbuffers.
Each table consists of multiple typed fields which can also be tables.
Each field is defined with name, type and optional default value, and fields can be optional.
The built-in types for the fields include assortment of fixed-size integer and floating-point numbers (no varints like in protobuf), vectors and strings.
It is possible to declare enumerations and unions too.
There is also `struct` in flatbuffers, which compared to tables are fixed-size data structures with all fields being required.
`struct` should be used only for known and fixed data, data that won't change in the future, as this will break the backward compatibility.

Internally, flatbuffers format use `vtable` for each table which acts as a map for that object, holding the offsets for each field in the table.
The `vtable` provides the backward compatibility, as older deserializer can simply ignore newer fields when checking for their offset.

> One of the most famous framework for deploying machine-learning models on edge devices, [LiteRT](https://ai.google.dev/edge/litert) (previously Tensorflow Lite), uses `.tflite` FlatBuffer format to represent the models.
{: .prompt-info }

## Framing layer

After serialization, the structured data is converted to stream of bytes, but in that stream of bytes, it is not clear where the data starts and where it ends.
For this reason, framing is performed on the stream to convert it to packet.
There are many ways to perform the framing and we will explore some of them below.

### Sync-Length framing

One of the simplest ways to frame the serialized data is to insert custom header before the data.
This header would have few bytes, consisting of sync bytes ("magic" bytes) and the length of the serialized data, thus called Sync-Length framing.
The sync bytes provide self-synchronization of the protocol, meaning the receiver can start decoding mid-packet, will discard that packet and will start decoding correctly the packets from the next one.
The sync bytes should have zero probability of appearing in the serialized data stream.
In practice, having zero probability of raw serialized bytes to contain the sync bytes is impossible, but the probability can be made negligible.
The probability can be made negligible by choosing longer sync bytes sequence and choosing the sync bytes in a way that they normally won't appear in the serialized data.

This method is useful for framing sensor data from embedded devices, as often one can choose ASCII code for the magic bytes, which is quite hard to find in raw sensor readings.
The length of the sync bytes should be 4 or more bytes.

Beside having sync bytes and length in the header, it is often useful to add other fields in it, depending on the use-case.
I find the following header structure useful:

```
+--------------------+
|    *Sync Bytes     | 4 or more sync bytes
+--------------------+
|  Protocol Version  | The protocol version allows to change the header in future, 1-3 bytes length
+--------------------+
|  *Payload Length   | The length of the serialized payload, typically 2 or 4 bytes, depending on the maximum payload size
+--------------------+
|    Payload Type    | Type of the payload (i.e. sensor data, battery level, command, log message, etc.)
+--------------------+
|       Flags        | Meta-information, like is data encrypted, is data compressed, is acknowledge requested, etc.
+--------------------+
|  Sequence Number   | Simple counter, to detect packet loss, duplicates or out-of-order packets
+--------------------+
```
{: file="Header for sync-length framing"}

The overhead is the length of the header, which is typically between 10-20 bytes.

### Length-prefix framing

If the underlying transport is reliable (like TCP/IP, USB, BLE), the sync bytes from the Sync-Length framing are not necessary and the framing protocol can be simplified to **Length-Prefix** framing, which basically prefixes the payload with its length.

### COBS (Consistent Overhead Byte Stuffing)

[COBS (Consistent Overhead Byte Stuffing)](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing) is a framing algorithm often used over UART. Its goal is to make a specific byte value (commonly 0x00) a reliable packet delimiter by ensuring the payload never contains that delimiter.
COBS guarantees a small, predictable overhead.

COBS works such that it removes every delimiter appearance, let's say 0x00, from the serialized data and replaces it with a number that tells the receiver where the next 0x00 was located.
As all the delimiter bytes are removed from the data, it is safe to add the delimiter at the end of the byte stream to mark the packet boundary.

```
1. Serialized data: 0x11, 0x22, 0x00, 0x33
2. Find the first 0x00 - index 2 (zero-based index)
3. Start the packet with count to the first 0x00 (2 + 1 because of this added byte): 0x03
4. Replace the 0x00 with distance to the next zero or end of data, in this case end of data
5. Packet data so far: 0x03, 0x11, 0x22, 0x02, 0x33
6. Add 0x00 at the end, as packet delimiter
7. Final packet: 0x03, 0x11, 0x22, 0x02, 0x33
```
{: file='COBS example'}

The overhead of COBS is 1 byte for each 254 bytes of data.
COBS is also very robust and it is self-synchronizing.

### SLIP (Serial Line Internet Protocol)

[SLIP (Serial Line Internet Protocol)](https://en.wikipedia.org/wiki/Serial_Line_Internet_Protocol) is simple packet framing protocol, initially used for wrapping IP packets for transport over serial wires, but it is very useful for framing in embedded systems.
In SLIP, two special bytes are used, one to act as packet delimiter (denoted as `END`) and another one for escaping or byte stuffing (denoted as `ESC`), which is used to resolve the issue of the data containing the packet delimiter.

There are few rules for the escaping:
1. If the data byte is `END`, it is replaced with 2-byte sequence `ESC ESC_END`, where `ESC_END` has different value from `END`.
2. If the data byte is `ESC`, it is replaced with 2-byte sequence `ESC ESC_ESC`, where `ESC_ESC` has different value from `ESC`.

Although start byte is not required, it is good idea to start the packet with `END`, to flush any garbage data before the packet.

```
END=0xC0, ESC=0xDB, ESC_END=0xDC, ESC_ESC=0xDD
1. Serialized data: 0x11, 0xDB, 0x22, 0xC0
2. 0x11, not special, write it to the packet
2. 0xDB is ESC, replace it with ESC ESC_ESC, 0xDB 0xDD
3. 0x22, not special, write it to the packet
4. 0xC0 is END, replace it with ESC ESC_END, 0xDB 0xDC
5. Packet data so far: 0x11, 0xDB, 0xDD, 0x22, 0xDB, 0xDC
6. Add END at start and end
7. Final packet: 0xC0, 0x11, 0xDB, 0xDD, 0x22, 0xDB, 0xDC, 0xC0
```
{: file='SLIP example'}

The overhead of SLIP is unpredictable compared to COBS, and in worst-case, in which the data contains only ESC and END byte values, the overhead is 100%, as the number of bytes is doubled.
SLIP is also very robust and self-synchronizing and SLIP decoder is very simple to implement.

### Which framing protocol to choose?

The choice of framing protocol depends on the underlying transport: transports differ in reliability, ordering, and fragmentation behaviour.

Transports like UART and RS-232 are unreliable, so Sync-Length, COBS, and SLIP are common choices; COBS and SLIP are often preferred.
On the other hand, when using USB CDC (Virtual Serial), which utilizes USB bulk transfers, is reliable as there is error correction and retransmission by the transport itself, so it is okay to use Length-Prefix framing in this case.

SPI and I2C transports are master-slave synchronous transports, in which the master needs to know how many clock cycles to generate for the data exchange.
For this reason, it is okay to use Length-Prefix framing, usually implemented with the Master first reading the header containing the length of the data, followed by the actual data transmission.

TCP is reliable transport, so again it is okay to use Length-Prefix framing.
TCP transport ensures packet are received in the correct order and handles error correction and retransmission logic.
On the other hand, UDP is unreliable and packets can be received out of order, duplicates are possible and fragmentation needs to be handled manually.
Typically this can be handled with the Length-Prefix framing, by ensuring to have a field for sequence number for the order correctness of the packets and way to handle the fragmentation in case data is larger than the UDP MTU (Maximum Transmission Unit), using fragment ID for example or utilizing the sequence number somehow.

[BLE (Bluetooth Low Energy)](https://en.wikipedia.org/wiki/Bluetooth_Low_Energy) transport, using [Generic Attribute Profile (GATT)](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-54/out/en/host/generic-attribute-profile--gatt-.html), is reliable, but uses small packets, and MTU is usually in range between 20-240 bytes.
It ensures that packets arrive in order, but the data should be chopped into smaller chunk manually (less than or equal to MTU).
For this reason, Length-Prefix framing can be used, starting with special fragmentation byte, that only contains info if this chunk is the first chunk, the end chunk, or middle chunk, and the the first chunk should send the total length of the data, while the next chunks only include fragmentation byte.

> BLE GATT supports two operations for transmitting data from one device, the peripheral, to another device, the central, notifications and indications.
These operations are the way that enables the peripherals to send data to the central whenever they have new data, but the central needs to enable them first.
The difference between the two is that indications need to be acknowledged by the **application** when the receiver processes the data.
On the other hand, notifications don't need acknowledgment by the application, but if the receiver doesn't process the received notifications in time, it is possible that some data can be dropped, as the transmit queue of the sender will be full.
Note that this is *application-level unreliability* of notifications, not *link-layer unreliability*.
The link-layer in BLE is reliable and it ensures that the data is received in order, without errors.
{: .prompt-info }

It is worth noting that although framing adds overhead, adding a few extra header bytes can be beneficial for transport-agnosticism and debuggability.
For example, Length-Prefix framing works over many transports, but Sync-Length headers can make debugging easier by including recognizable sync bytes.

## Benchmarks

We will compare the serialization protocols by running benchmark on microcontroller platform.
We will measure:
- encoding time,
- decoding time,
- wire size,
- memory usage (code and RAM).

[STM32F411CE](https://www.st.com/en/microcontrollers-microprocessors/stm32f411.html) MCU [board](https://stm32-base.org/boards/STM32F411CEU6-WeAct-Black-Pill-V2.0.html) will be used, known as blackpill, which has Cortex-M4 core with floating-point unit, running at 100 MHz max clock frequency, 128 kB of SRAM and 512 kB of Flash.
The code for the benchmark is available on [GitHub](https://github.com/BojanSof/embedded-serialization-formats-benchmarks).

We are going to evaluate the performance of 4 serialization formats:
- Custom binary encoding,
- Protocol Buffers ([nanopb](https://github.com/nanopb/nanopb)),
- [Flatbuffer](https://github.com/google/flatbuffers), and
- CBOR ([zcbor](https://github.com/NordicSemiconductor/zcbor)).

The data in the benchmark come from imaginary AR maintenance glasses, battery-powered, which have IMU to track head orientation, eye-tracking cameras to track the gaze of the technician and outwards-facing camera, to capture image of what the technician is looking at.
They send this data over WiFi.
The head orientation is represented with [quaternion](https://en.wikipedia.org/wiki/Quaternion) (array of 4 values), the gaze is represented with 2D vector and the image sent by the device is in JPEG format.

In the protocol, there are 3 kinds of payloads:
- `StatusPayload`, containing generic device info: battery percentage, wifi RSSI and uptime in seconds,
- `SensorPayload`, containing the sensor data, that is the head orientation and the gaze vector,
- `ImagePayload`, containing the JPEG image.

Beside the payload, each packet also contains `deviceID` and `timestamp` when the packet is sent.

> Note that the code for the benchmark on GitHub is dirty and some parts are generated using AI coding agents.
It serves merely for illustrative purpose and provides insights how to use the serialization libraries.
{: .prompt-info }

The benchmark consist of two tests: one to serialize/deserialize smaller sensor data payload, and another test with larger image payload.
The MCU CPU is configured to run at 84 MHz clock frequency.
The cycle counter in the Cortex-M4 core is used to measure the execution time of the code.
The code is built with `-O0 Og` flags.

The results of the benchmark are given in the tables below.

### Small data benchmark

#### Serialization

| Protocol                  | Packet size (bytes) | Avg cycles | Avg time (us) |
| :------------------------ | ------------------: | ---------: | ------------: |
| Custom binary encoding    | 43                  | 2832       | 33.714        |
| Protocol buffers (nanopb) | 18                  | 16606      | 197.690       |
| FlatBuffers               | 88                  | 16163      | 192.416       |
| CBOR (zcbor)              | 72                  | 6150       | 73.214        |

#### Deserialization 

| Protocol                  | Avg cycles | Avg time (us) |
| :------------------------ | ---------: | ------------: |
| Custom binary encoding    | 2515       | 29.940        |
| Protocol buffers (nanopb) | 14989      | 178.440       |
| FlatBuffers               | 8752       | 104.190       |
| CBOR (zcbor)              | 15012      | 178.714       |

### Large data benchmark

#### Serialization

| Protocol                  | Packet size (bytes) | Avg cycles | Avg time (us) |
| :------------------------ | ------------------: | ---------: | ------------: |
| Custom binary encoding    | 7498                | 48270      | 574.642       |
| Protocol buffers (nanopb) | 7503                | 63246      | 752.928       |
| FlatBuffers               | 7544                | 98630      | 1174.166      |
| CBOR (zcbor)              | 7499                | 57027      | 678.892       |

#### Deserialization 

| Protocol                  | Avg cycles | Avg time (us) |
| :------------------------ | ---------: | ------------: |
| Custom binary encoding    | 1775       | 21.130        |
| Protocol buffers (nanopb) | 15445      | 183.869       |
| FlatBuffers               | 9018       | 107.357       |
| CBOR (zcbor)              | 10306      | 122.690       |

### Discussion on the results

There are few insights that we can take even from these simple benchmarks.

In case of smaller data payloads, we are often interested in two things.
The time to perform the serialization and deserialization is one thing that we want to be low, highlighting the CPU cost of the format.
The other thing is the protocol overhead (headers, metadata, etc.), which we also want to be as low as possible.

In case of larger data payloads, often the size of the actual payload is much greater compared to the protocol overhead, so we can simply ignore it in most of the times.
However, we want the serialization/deserialization time to be low, so we can achieve high throughput, ideally greater or equal to the used underlying transport.
The throughput can be calculated from the data by simply diving the packet size and the time needed for serialization and deserialization.

The plots below show the discussed points.

![Benchmark results plots](/assets/img/mbedcom/benchmark-results-light.svg){: .light}
![Benchmark results plots](/assets/img/mbedcom/benchmark-results-dark.svg){: .dark}
_Plots for the benchmark results_

For the small data payload, we can see that Custom Binary Encoding has the smallest latency for serialization and deserialization, which is expected, as it performs simple memory copy operations and adds minimal header during serialization, while for the deserialization it does zero parsing.
Protocol buffers on the other hand provide smallest serialized data size, simply because the use Varint encoding, which strips the zeros and compresses some of the integers.
The protocol buffers size is dependent on the content, but for sensor data that can have a lot of zeros or small values, it would often beat custom binary encoding, which would use the whole integer width.
The FlatBuffers size is worst in this case, as the format adds a lot of overhead, including vtables, offsets and alignment padding.
The serialization is slow, but the deserialization is good, second after custom binary encoding, which is expected, as that is the main feature of FlatBuffers.
Finally, CBOR serialization speed is good enough, the serialized stream size is larger than custom binary encoding and protobuf due to added type tags for each field.
CBOR can be considered as middleground.

For the larger data payload, custom binary encoding is winner, especially in deserialization, as it can be implemented simply by creating pointer on the memory of the receiving buffer.
The serialization throughput for custom binary encoding in this case is implemented by copying the input data in a transmission buffer.
FlatBuffers provide second best deserialization throughput, which is expected, but the serialization throughput is lower compared to the other protocols due to how the library handles the memory.

## Conclusion

There are a lot of ways to create a protocol for data exchange on embedded devices.
We covered some of the most famous serialization protocols and framing protocols, looking into their strengths and weaknesses.
Custom binary encoding can be the most optimal one in case where the data is already defined and there is no need for big flexibility in the communication protocol.
If flexibility is needed, protocol buffers are great way of sacrificing additional CPU cycles to achieve it, while also providing some size compression.
When there is a need to read large data without parsing, flatbuffers are the best choice.
Finally, use CBOR when standard, lighter and more-compact self-describing format is needed compared to JSON, but don't want to end up handling schema setups, like the ones used in flatbuffers and protocol buffers.