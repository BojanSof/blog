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
We will use the term *message* to describe the payload that is exchanged in the communcation.

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

Now although in this trivial case each message is of fixed length and we probably can go without framing, but for the sake of completness we will provide a way to frame the data, so we can find the start and end of each message.
In the framing layer in this example, we can use [COBS (Consistent Overhead Byte Stuffing)](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing), which we will cover in more details later, but esentially what COBS does is replacing the zeros in the payload with non-zero values representing the distance to the next zero or the end of the packet, also denoted with zero:
```
[0x01, 0x01, 0x04, 0xc4, 0x41, 0x33, 0x00]
```

On the data link layer, the [UART](https://en.wikipedia.org/wiki/Universal_asynchronous_receiver-transmitter) controller of the device adds start, stop and parity bits to each byte of the packet, to get the final bit stream (we use [8N1 format](https://en.wikipedia.org/wiki/Serial_port#Conventional_notation)):
```
0100000001 0100000001 0001000001 0001000111 0100000101 0110011001 0000000001
```

Finally, this bit stream is converted to appropriate voltage levels with correct timing, depending on the used baud rate for the communication.
If we use baud rate of 9600, then each bit has duration of 1/9600 ≈ 104 us, bit 0 is represented with voltage level between 5 V and 15 V in RS-232, while bit 1 is represented with voltage level between -15 V and -5 V.

The receiving side performs the steps described in each layer, but in reverse direction.

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
Basically, the developer sets the endianess of the data, how many bytes each field occupies and defines in which order the high-level data fields are serialized.
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

### CBOR

### FlatBuffers

### Modbus



| Serialization format                                             | Compactness | Schema                     | Best use                        |
| :--------------------------------------------------------------- | :---------: | :------------------------: | :------------------------------ |
| C structs                                                        |   🔴 Low    | None (Self-describing)    | Web (Cloud, APIs)               |
| Protocol Buffers (nanopb)                                        |   🔴 Low    | None (Self-describing)    | Configuration                   |
| CBOR      |   🟡 Medium | Implicit (Column order)   | Data logging                    |
| MessagePack      |   🟡 Medium | Implicit (Column order)   | Data logging                    |
| FlatBuffers      |   🟡 Medium | Implicit (Column order)   | Data logging                    |
| ModBus      |   🟡 Medium | Implicit (Column order)   | Data logging                    |