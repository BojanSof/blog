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