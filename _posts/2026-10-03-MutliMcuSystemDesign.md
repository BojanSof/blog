---
title: Designing systems with multiple MCUs
date: 2026-10-03
categories: [Embedded Systems, Software, Firmware, Hardware]
tags: [embedded, software, firmware, hardware]
math: true
image:
  path: /assets/img/multimcu/cover.webp
---

Embedded systems are often designed around a single microcontroller, but as systems become more complex, that approach can start to introduce unnecessary compromises.
Using multiple MCUs can be a practical architectural choice when different parts of the system have very different requirements.

A multi-MCU design can be useful for several reasons:

- **Power optimization**: a low-power MCU can remain active most of the time, while a more powerful MCU is enabled only for demanding workloads such as camera processing, DSP, or machine-learning inference.
- **Simpler PCB and interconnect design**: instead of routing many peripheral signals across physically separated boards, a local MCU can manage nearby hardware and communicate with the rest of the system over only a few wires.
- **Functional integration**: a secondary MCU may replace several smaller support ICs by providing GPIO expansion, ADCs, PWM, protocol translation, sensor aggregation, or other local functions.
- **Modularity and expandability**: additional boards can contain their own MCU and expose a well-defined interface to the main controller, making the system easier to extend or reuse.
- **Isolation of responsibilities**: communication, real-time control, high-performance processing, safety functions, and system management can be separated into independent processing domains.

The main drawback is that a multi-MCU design creates a small distributed system.
The MCUs need a reliable communication protocol, firmware versions must remain compatible, boot and update sequencing must be considered, and failures such as one MCU being unresponsive or running incompatible firmware need to be handled.
Debugging can also become more difficult because problems may cross hardware, firmware, timing, and communication boundaries.

Because of this, it is great to check other solutions before adding another MCU in the system.
A larger single MCU may already provide enough processing power, peripherals, memory, and low-power modes for the whole system.
Another option is a multicore or heterogeneous SoC, where different cores can handle tasks such as networking, real-time control, application logic, or high-performance processing while still benefiting from fast internal communication and shared memory.

These alternatives are often simpler when all functionality is located in the same physical area and the processing domains need to exchange large amounts of data.
However, they are less useful when the main reason for separation is physical placement, independent power control, specialized peripherals, modular hardware, or reducing the amount of wiring between different parts of the system.

A good rule of thumb is therefore to use multiple MCUs when the hardware already divides naturally into distinct subsystems.
If each subsystem has its own processing, power, peripheral, or physical-placement requirements, giving it some local intelligence can simplify the overall system.
If the only reason for adding another MCU is that the main MCU is running out of processing power or peripherals, it is usually worth checking whether a more capable single MCU or heterogeneous SoC would provide a simpler solution first.

In this blog post, we will strictly concentrate on multi-MCU systems, describe the difficulties regarding the management of such system, and practical demonstration using nRF54L15 and STM32U083 based dev boards.

## Practical examples of multi-MCU systems

To illustrate the problem, it is good to share some practical applications that benefit from multi-MCU design.

### Battery-powered smart camera sensor

Whether it is for industrial monitoring application, wildlife capture or some kind of wearable device that captures photos when sensors detect something, this is good candidate for multi-MCU system.
Practical choice of components may include Nordic nRF54L15 BLE module, which is the low-power MCU, running most of the time, sampling sensors and sending data and statistics over BLE, while we can have higher-performance STM32N6 MCU, which has MIPI CSI-2 interface and image signal processing (ISP) module, so one can connect higher resolution camera sensor to it, and get higher quality images and run some vision AI model on it, such as object detection model.
Once the sensors which are samples on the nRF54L15 detect specific event (such as motion detected using PIR sensor, or vibration analysis using IMUs), the STM32N6 MCU can be powered-on, capture photo, run the vision AI model if required and be powered-off.
To ensure operations get done as quickly as possible, using SPI physical connection between the MCUs (Nordic is master, STM is slave) is the preferred choice, along with some kind of interrupt/handshake pin for STM to notify the Nordic chip when it has some data available.
This is typical scenario of dividing specific tasks, because of peripheral availability (MIPI CSI-2 interface, ISP pipeline are available on the STM chip) and power management (Nordic is low-power, can handle sensors and communication, while STM only gets powered on when needed).

### Smart appliances - washing machine

If we take the example of modern smart washing machine, we can separate the tasks of the washing machine in two parts:

1. The main logic for driving the motor, controlling the water pump, the draining system, the door, error control, etc.;
2. The UI of the washing machine, including the rotary encoder for program selection, the display, potentially the WiFi module it has for remote control.

These functions can be separated and handled by two MCUs, that may have different set of peripherals as their required functionalities are different.

Similar concept can be applied to other (smart) appliances.

### True Wireless Stereo (TWS) Earbuds

TWS earbuds are great example of multi-MCU system, coming from the nature of the system.
There are two earbuds, and each one of them needs local processing for Audio, Bluetooth, microphones, touch control, wear detection, battery monitoring and a lot of times Active Noise Cancellation (ANC).
In this system, the charger case is also another subsystem, whose MCU handles: charging control and battery monitoring, detecting whether earbuds are inserted, LEDs and buttons, firmware update functions.

## Difficulties managing multi-MCU systems

Managing system with multiple MCUs has its difficulties.
The main reason for this is that the system is not controlled by single firmware anymore, instead every MCU in the system has its own state, timing, firmware version, behaviour and responsibilities, so the system behaves like small distributed system.
We are going to list the most important challenges and provide ways to handle them.
It is important to understand that all the difficulties are manageable, but they should be treated as part of the system design, rather than think how to resolve them later.

### Inter-MCU communication

The MCUs must communicate between each other, so they need clearly defined protocol for exchanging commands, events, status and data.
This includes choosing the physical interface for communication, such as I2C, SPI, UART or something else, and also defining the protocol that runs on top of it.
This is probably the most important interface to design, as it will make it easier to develop each subsystem and prevent complexity from spreading throughout the rest of the firmware.

#### Choosing the physical interface

The physical interface choice depends on multiple factors, and it is not simply the choice of the communication protocol, but also the additional lines needed to control the MCUs.
Some of the key decisions are listed below.

#### Required bandwidth

Based on the required bandwidth of data that needs to be transferred between the MCUs, one could choose one of these protocols, but not limited to only them:

- I2C: low to mid data rates, allowing for multiple devices on same bus
- UART: simple point to point communication, good for commands/logging
- SPI: high throughput, low latency, more wires and requires master/slave topology

The distance and PCB topology can constrain the protocol choice.
If the design lives on single PCB, probably I2C/UART/SPI can be fine, but if the design is on a separate PCB, the protocol choice beside signal integrity, it should consider grounding, connector pin count, differential buses, etc.

The relationship between the MCUs is also factor affecting the choice.
Typically, the choice is master/slave, in which one MCU controls other MCUs and initiates the communication.

It is also important to take the voltage domains into consideration, as level shifters may be needed for proper functioning.

Additionally, beside the pins for the communication interface, it is often useful to have additional GPIOs between the MCUs, used for interrupt and event handling.
For example, instead of the master MCU asking if there is data or event available from the slave MCU, slave MCU can assert interrupt pin, notifying the master that new data or event is available.
Similarly, having ready/busy pin can help when secondary processor has longer processing run.

Beside the protocol choice, it is also important to select the proper control lines between the MCUs, mainly for fault and firmware recovery and updates and power control.
It is often useful if one MCU can control the reset state of other MCU and its boot strapping pins, making fault recovery and firmware recovery and updates easier.
This comes in handy with many MCUs that have ROM bootloaders, such as STM32.
Power enable and wake pins are also useful for controlling the power of secondary MCUs.

### Startup and shutdown sequencing

The MCUs may not boot at the same time, and in most cases one MCU controls the power of another MCUs.
Therefore, the system should define what happens if one MCU is still booting, is powered off, restarting or temporarily unavailable.

Few solutions can be applied for proper startup sequencing.
The simples one is to know the boot time of the secondary MCU, and the main MCU just needs to wait for period of time longer or equal to the secondary MCU boot time.
Another approach is to have dedicated READY pin, which the secondary MCU will assert, once it is booted up and initialized.
It is important for the system to set safe default state pin values, such as communication interface pins, ensuring GPIOs won't back power MCUs, non-floating interrupt pins, etc.
But, it is worth mentioning that startup sequencing is not only firmware problem, but the hardware should also consider to set safe default states, for pins controlling motors, heaters, power-control outputs, etc.

### Failure handling

There are many failures that can happen, such as communication timeouts, corrupted messages, crashed firmware, watchdog resets and all of them need predictable behaviour.
It is important to treat failures as expected system states, rather than exceptional events.

#### Timeout: basic recovery strategy

The most basic recovery strategy are timeouts.
Simple demonstration is if secondary MCU is not responding over communication interface within a timeout interval, then the host MCU should retry limited number of times and as final solution try to reset the secondary MCU.
If nothing happens even after that, then the appropriate subsystem driven by the secondary MCU has failed.

#### Independent watchdogs

Another good failure handling strategy is every MCU to have independent watchdog.
The watchdog may independently reset hang secondary MCU without affecting the rest of the system.

#### Heartbeat signal

For more critical systems, the host can supervise the secondary MCUs by checking heartbeat signal generated by them.
If heartbeat signals are missed, then the appropriate subsystem may be unhealthy.

#### Communication protocol error handling

The communication protocol running on top of the physical interface for communication between the MCUs should at least have proper mechanisms for error detection.
Useful mechanisms include:

- message length verification
- sequence numbers
- checksums/CRCs
- acknowledgment when required
- command timeouts
- protocol versioning

#### Degraded operation

Secondary MCU failure does not always make the whole system unusable.
The host MCU may be able to report the failure, provide some basic measurements, accept diagnose commands and last but not least perform firmware updates.
So the system can have different levels of operations, such as: Normal, Degraded, Recovering and Failure.

#### Persistent fault information

It is quite important to store the fault persistently, surviving system reset, at least until it is read back.
Typically, useful fault information include:

- reset reason
- last command
- last protocol error
- boot count
- firmware version
- failed recovery count

Typical storage for such info are backup registers, retained RAM or non-volatile memory.

### Firmware compatibility and updates

One of the biggest complications in multi-MCU system are firmware updates, and firmware compatibility between MCUs in the system.
Each MCU in the system typically has its own application firmware, bootloader, release cycle and dependencies on firmware running on other MCUs.

It is quite important to resolve firmware compatibility.
If the protocol for communication between the MCUs changes, then updating single MCU may leave the system in incompatible state.
For this reason, beside firmware version, it is important for every MCU in the system to expose additional info, mainly the protocol version, so the system can verify compatibility during boot-up.
The protocol should be versioned independently from the firmware, as different firmwares on different MCUs, having different firmware versions, can still run the same protocol version.
Also, it may be preferable if the protocol changes are additive, meaning there is backwards compatibility.
This means that it is preferable to keep old commands and add new commands, instead of change/remove old commands.

#### Who controls firmware updates?

In a multi-MCU system, a common architecture is to use single host MCU which updates the firmware of the other MCUs.
The host MCU receives the firmware update images and performs the required steps for secondary MCUs updates, such as entering bootloader mode (if app firmware doesn't support loading update image), transferring image, and finally resetting the secondary MCU.

#### Bootloader choice

Some MCUs come with existing ROM bootloaders, such as majority of STM32 MCUs, and by setting BOOT and RESET pins, one can select the appropriate bootloader mode.
Many STM32 MCUs allow to enter modes for updating firmware utilizing protocols such as SPI, I2C, UART.

Another solution, which is probably better in the long run, is to have custom bootloader, that can allow for:

- image authentication,
- rollback,
- multiple slots,
- recovery,
- system specific commands.

This bootloader is flashed during manufacturing and should be simple and well-tested.
If the MCU has ROM bootloader, that one can be used eventually for recovery, if the custom one fails for some reason.

#### Multi-MCU update image

When updating multi-MCU system, if the whole system needs to be updated, we can store multiple firmware images in a single update file, and additionally manifest file.
The manifest file should include basic info for the firmware images, such as firmware versions, protocol versions, hardware compatibility, image sizes, image hashes, signatures and potentially update order.

### Debugging

Debugging system with multiple MCUs poses some challenges, as bugs may depend on the timing and interactions between the MCUs.
On a development system, it is worth exposing debugging interface (SWD/JTAG) and additionally logging interface, such as UART, for each MCU.
The log messages should ideally be unified and include timestamps, MCU ID, message sequence number, error codes.

It is also quite useful to have access to the communication interface lines between the MCUs, to be able to hook logic analyzer, for easy inspection of wrong message lengths, incorrect timings, invalid line states, timeouts, etc.
Beside com interface lines, it is good to have access to power-related lines too, for easy checks and inspection.

Finally, if possible, it is good to include additionally debugging GPIOs on the MCUs, which can be checked for example together with the com interface lines using logic analyzer, to signalize whether command was received, processing was started, completed, or similar states.

### Repository and build management

The firmware project for each MCU typically has its own SDK, toolchain and build system, but it also depends on shared protocol library.
This does raise few question how to manage the projects in synchronized manner.
When starting the project, it is better idea to keep all firmware and protocol files in single repository.
But, eventually, once the initial implementation gets stable enough, the projects should be separated into multiple repositories.

## Practical demonstration

Now, we will take the concepts discussed above and apply them to a system with an **nRF54L15-DK** as the host and a **NUCLEO-U083RC** as the secondary node.
The choice is demonstrative: the Nordic MCU manages the system and exposes its controls to a PC, while the STM32 implements the functions of a separate module.

![Practical demo setup](/assets/img/multimcu/demo_setup.jpg)
*The practical demonstration setup*

The complete project is available in the [Multi-MCU Lab repository](https://github.com/BojanSof/multi-mcu-system).
The code links below point to [the implementation used for this article](https://github.com/BojanSof/multi-mcu-system/tree/34b9b8112c840a281d0a6da768187e05c71edc89), so the examples remain connected to the same source even if the project changes later.

The STM32 provides a virtual sensor, a virtual actuator, and events from its onboard user button.
Here, **virtual I/O means software models of inputs and outputs**: the sensor generates numbers, and the actuator models an operation that takes time and reports progress.
There is no physical sensor, motor or power switching circuit behind these two services.
The onboard button, UART communication, watchdogs and flash programming are real hardware operations.
This allows us to concentrate on communication and system management using only the two boards and jumper wires.

### System architecture

The system has three main components: the PC, the Nordic host and the STM32 node.

The PC runs `mmctl`, which communicates with the Nordic host through its J-Link virtual COM port.
The host controls the STM32 through UART and the READY, IRQ_N, RESET and BOOT0 signals.
STM32 runs either its service application, the custom bootloader or the factory-ROM bootloader, depending on the selected operating mode.

The [Nordic application](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/main.c) runs on Zephyr through nRF Connect SDK.
It discovers the node, sends requests, monitors its state, and manages updates and recovery.
The [STM32 application](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/AppRtos.c) uses STM32 HAL and FreeRTOS, while its custom bootloader is a separate bare-metal application.
The node executes accepted operations locally, meaning that the host does not need to drive every step of an actuator operation.

The PC command-line application, `mmctl`, is used to operate the host.
It uses [SMP, the Simple Management Protocol](https://docs.zephyrproject.org/latest/services/device_mgmt/smp_protocol.html), with [CBOR](https://cbor.io/) to encode structured data such as commands, numbers and byte arrays.
The [PC client](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/tools/cli/smp.py) and [Nordic control handlers](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/control/HostControl.c) implement this interface.

It is important to distinguish the two communication links: PC-to-Nordic uses SMP, while Nordic-to-STM32 uses our own bounded binary protocol.
On the DK, the PC connection passes through the J-Link debugger's USB-to-UART bridge.
It is not a native USB interface implemented by the Nordic application.

### Physical interface and control signals

The inter-MCU link uses **UART at 115200 baud, 8N1**, meaning eight data bits, no parity and one stop bit.
There is no RTS/CTS hardware flow control on this link.
UART provides enough bandwidth for the demonstrated commands and events, and the selected STM32 pins can also be used by its factory-ROM bootloader.

The connections are:

| Signal | Nordic GPIO | STM32 connection | Purpose |
|---|---|---|---|
| Host TX → node RX | `P1.11` | `PA10` | Commands and update data |
| Node TX → host RX | `P1.12` | `PA9` | Responses and events |
| READY | `P2.06` | `PB5` | Node application initialized and available |
| IRQ_N | `P2.08` | `PB4` | Active-low pending-event indication |
| RESET | `P1.08` | `NRST` | Host-controlled node reset |
| BOOT0 | `P1.14` | `BOOT0` | Select factory-ROM recovery |
| GND | GND | GND | Common signal reference |

The [pinout](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/hardware/PINOUT.md) includes the exact connector positions and board restrictions, and the [wiring guide](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/hardware/WIRING.md) describes the connection procedure.
Also, Nordic `P1.08` shares the DK's second button, so pressing that button physically resets STM32 with this wiring.

RESET is driven open-drain: Nordic either pulls it low or releases it, avoiding a push-pull conflict with the board's reset circuitry.
BOOT0 stays low during normal operation and is raised only for an explicit factory-ROM recovery operation.

> Before connecting signals, Nordic I/O voltage needs to be configured at **3.3 V**, matching the STM32 board.
> Both boards are independently USB-powered, and their supply rails are not connected together.
> This can be done using Board Configurator app, which can be installed using [nRF Connect for Desktop](https://www.nordicsemi.com/Products/Development-tools/nRF-Connect-for-Desktop).
> The power order should be Nordic first, then STM32.
{: .prompt-warning }

### Software layers: protocol, node API and virtual I/O

The software separates UART transport, message framing and service handling.

The board-specific UART adapter supplies bytes to the protocol library.
Decoded requests pass through the node API and service registry to the appropriate handler.
Responses and asynchronous events return through the same layers.

The [protocol library](https://github.com/BojanSof/multi-mcu-system/tree/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/protocol) defines how bytes become frames.
It knows about encoding, lengths, sequence numbers and CRCs, but it does not know what a sensor is or which UART peripheral a board uses.

The [node API library](https://github.com/BojanSof/multi-mcu-system/tree/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/node-api) defines the common service types, status codes, version checks, registration and dispatch.
A **service** is a group of related commands and events identified by a numeric ID.
For example, the sensor service has a sample command, while the lifecycle service has commands for versions, maintenance and fault history.

The **service registry** is a fixed-size table in STM32 RAM.
Each entry connects a service descriptor—its ID, version and flags—to a handler function and a context pointer.
The handler implements the commands, and the context points to its state, such as a sensor's sample index or an actuator's current operation.
The [registry implementation](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/node-api/src/NodeApi.c#L22-L42) supports at most eight services without dynamically allocating memory.

The simulated functions live separately in [examples/virtual-io](https://github.com/BojanSof/multi-mcu-system/tree/34b9b8112c840a281d0a6da768187e05c71edc89/examples/virtual-io).
The STM32 [application integration](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/AppServices.c) registers these functions alongside diagnostics, lifecycle and real button events.
This separation is useful if we later replace the virtual sensor with an ADC or another local peripheral: its handler changes, while the generic message and discovery mechanisms can stay the same.

### Inter-MCU communication protocol

The framing implemented in the protocol library is:

`COBS(header + payload + CRC32) + 0x00`

[COBS (Consistent Overhead Byte Stuffing)](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing) encodes the frame so zero does not occur inside it, allowing `0x00` to mark the frame boundary.
This is useful because UART delivers a stream of bytes, rather than complete messages.
A frame can arrive in several pieces, and several frames can arrive in one buffer.

The decoded frame contains:

| Field | Size | Purpose |
|---|---:|---|
| Magic | 2 bytes | Identify the protocol |
| Wire major version | 1 byte | Check framing compatibility |
| Message kind | 1 byte | Request, response or event |
| Flags | 1 byte | Includes response-error indication |
| Sequence number | 2 bytes | Match a request and its response |
| Payload length | 2 bytes | Validate payload bounds |
| Payload | Up to 243 bytes | Management or service data |
| CRC32 | 4 bytes | Detect accidental corruption |

The complete decoded frame is bounded to 256 bytes, including its header and CRC, so the receiver can use fixed-capacity buffers.
Multibyte fields are explicitly encoded little-endian.
For example, the [frame encoder](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/protocol/src/Protocol.c#L151-L201) writes the header individually:

```c
Protocol_WriteUint16(&decoded[0], PROTOCOL_MAGIC);
decoded[2] = PROTOCOL_WIRE_VERSION_MAJOR;
decoded[3] = (uint8_t)frame->kind;
decoded[4] = frame->flags;
Protocol_WriteUint16(&decoded[5], frame->sequence);
Protocol_WriteUint16(&decoded[7], frame->payload_length);
```
{: file="libraries/protocol/src/Protocol.c: header serialization" }

After copying the payload, it appends the CRC:

```c
decoded_length = PROTOCOL_HEADER_SIZE + frame->payload_length;
crc = Protocol_CalculateCrc32(decoded, decoded_length);
Protocol_WriteUint32(&decoded[decoded_length], crc);
decoded_length += PROTOCOL_CRC_SIZE;
```
{: file="libraries/protocol/src/Protocol.c: frame checksum" }

This avoids transmitting a C structure whose padding, alignment or byte order could depend on the compiler and target.
The [stream parser](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/protocol/src/Protocol.c#L269) accumulates partial input, validates the frame and passes accepted messages to the next layer.
Corrupt or oversized input is rejected, and parsing can recover at a subsequent zero delimiter.

### Discovering the node and its services

The host first checks that the node is available and compatible, and then the [node manager](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/node_manager/HostNodeManager.c#L390) follows this exchange:

1. Wait for READY, then send `HELLO` to obtain the current session and API versions.
2. Read the node identity and capability bitmap.
3. Enable reliable events if both sides support them.
4. Read the service descriptors and check compatibility before marking the node online.

The capability bitmap advertises optional mechanisms, such as acknowledged events.
The service list identifies the functions available on this particular node:

| Service | ID | Function |
|---|---|---|
| GPIO events | `0x0001` | Report onboard button changes |
| Diagnostics | `0x0002` | Fault records and development injections |
| Lifecycle | `0x0003` | Versions, operating modes and fault history |
| Virtual sensor | `0x1001` | Return simulated integer samples |
| Virtual actuator | `0x1002` | Execute a timed operation with progress |

The descriptors contain IDs, versions and flags.
Registering the sensor associates its descriptor with the implementation:

```c
registration.descriptor.service_id = VIRTUAL_IO_SENSOR_SERVICE_ID;
registration.descriptor.version_major = VIRTUAL_IO_VERSION_MAJOR;
registration.descriptor.version_minor = VIRTUAL_IO_VERSION_MINOR;
registration.descriptor.flags = 0U;
registration.handler = VirtualIo_SensorHandler;
registration.context = instance;

status = NodeApi_RegisterService(registry, &registration);
```
{: file="examples/virtual-io/src/VirtualIo.c: service registration" }

Firmware versions and interface versions are checked separately.
The [service compatibility rule](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/node-api/src/NodeApi.c#L11-L14) requires an equal major version and an offered minor version at least as high as the required one.
For example, a host requiring service `1.0` can use `1.1` when the minor change preserves the existing commands.
An incompatible optional sensor service does not prevent access to compatible lifecycle and diagnostic services.

### Example: requesting a sensor sample

Once project is build and installed, to request sensor sample we can run the following script:

```sh
scripts/mmctl device list
export NRF_PORT=/dev/serial/by-id/YOUR_NORDIC_JLINK_PORT
scripts/mmctl --port "$NRF_PORT" services list
scripts/mmctl --port "$NRF_PORT" sensor sample
```
{: file="Terminal: discover services and request a sample" }

`NRF_PORT` represents the Nordic J-Link virtual COM port (typically the one enumerated second).
The CLI's outputs JSON data.

The request passes through these components:

1. The PC sends a structured SMP command to Nordic.
2. Nordic admits the request, assigns an operation ID and sends a binary service call to STM32.
3. The STM32 [transport adapter](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/NodeTransport.c#L156-L198) decodes the fields into a `NodeApi_ServiceRequest`.
4. [NodeApi_DispatchRequest](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/node-api/src/NodeApi.c#L56-L106) finds the service in the registry and calls its handler.
5. The handler returns result bytes, which travel back through the same layers.

For an illustrative session `0x12345678` and operation `7`, the service-call payload is:

```text
00 01          SERVICE_CALL message: 0x0100
78 56 34 12    Current session: 0x12345678
01 10          Virtual sensor service: 0x1001
01 00          Sample command: 0x0001
07 00 00 00    Operation ID: 7
```
{: file="Example service-call payload" }

These are decoded payload bytes, with the outer header, CRC and COBS encoding omitted.

The [sensor handler](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/examples/virtual-io/src/VirtualIo.c#L17-L37) generates a deterministic value from its seed and sample index:

```c
mixed = instance->seed +
        (instance->sample_index * 1664525U) +
        1013904223U;

sample = (int32_t)(mixed % 2001U) - 1000;

VirtualIo_WriteU32(&response->data[0], (uint32_t)sample);
VirtualIo_WriteU32(&response->data[4], instance->sample_index);
```
{: file="examples/virtual-io/src/VirtualIo.c: deterministic sensor model" }

The eight-byte response contains a signed sample and an unsigned sample index.
For example, the CLI can decode it into the following fields:

```json
{
  "decoded": {
    "value_milli_units": -132,
    "sample_index": 0
  }
}
```
{: file="Example decoded sensor result" }

A given seed and index produce the same sample, making tests repeatable without external hardware.

### Example: an operation that takes time

The virtual actuator demonstrates an asynchronous operation:

```sh
scripts/mmctl --port "$NRF_PORT" actuator start --duration-ms 2000
scripts/mmctl --port "$NRF_PORT" events watch
```
{: file="Terminal: start an actuator operation" }

Its [handler](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/examples/virtual-io/src/VirtualIo.c#L93-L131) checks the command, duration and busy state, then starts the operation and returns an execution number.
[VirtualIo_Tick](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/examples/virtual-io/src/VirtualIo.c#L189-L235) is called periodically to advance it using elapsed time.
There is no two-second sleep inside the command handler, so communication can continue while the modeled operation runs.

For example, an actuator request with operation ID `8` can return execution number `1`, then publish progress at 25%, 50% and 75% before completion.
The host can handle sensor requests while the actuator runs, with one ordinary request awaiting a response at a time.
Progress timing follows the application's scheduling rather than being a hard real-time timing guarantee.

There are actually three stages to consider: **Nordic admits the PC request**, **STM32 accepts the operation**, and **the operation completes**.
The first CLI record containing `request_id` and `operation` confirms host admission only.
It is not proof that STM32 has already executed the command.
The [control handlers](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/control/HostControl.c#L427) and later node response/event records keep these stages separate.

### Retries, operation IDs and sessions

A missing response does not necessarily mean that the node missed the command.
The node might have started the operation successfully, but its response was lost.
Therefore, retrying must preserve the logical operation identity.

For example, if acceptance of operation `8` is lost, the host retries operation `8` with the same arguments.
The node returns the original execution number instead of starting the actuator again.

The actuator checks its history before starting another execution:

```c
if (VirtualIo_FindOperation(instance, request->operation_id,
                            &execution)) {
    VirtualIo_WriteU32(response->data, execution);
    response->data_length = VIRTUAL_IO_ACTUATOR_START_RESPONSE_SIZE;
    return NODE_API_STATUS_OK;
}
```
{: file="examples/virtual-io/src/VirtualIo.c: duplicate-operation lookup" }

The generic registry caches its most recent successful request and response, including service, command, operation and argument bytes.
The actuator additionally retains eight operation IDs and their execution numbers.

The identifiers have different responsibilities:

| Identifier | Example | Meaning |
|---|---|---|
| Transport sequence | `43` | Match an ordinary request and response |
| Operation ID | `8` | Associate acceptance, progress and completion with one operation |
| Node session | `0x12345678` | Distinguish the current node generation from stale work |
| Reliable event number | `21` | Identify one event transmission for acknowledgment and deduplication |

A service event type such as “progress” is a command-schema value, not the reliable event number.
One operation can produce several progress/completion events, each with its own delivery number.
The PC also has a request ID and Nordic boot ID to prevent a reconnect from blindly replaying an old mutating command.

On node restart, the host discards pending work and performs discovery again.
Sessions are useful for rejecting stale messages, but this implementation derives them from a word of the chip's unique ID and a retained boot counter.
They can repeat after cold power loss.
That is another reason not to describe the mechanism as durable exactly-once execution.

The diagnostics service supports deliberate fault injection in development builds, such as dropping one actuator acceptance response to exercise retries.
The [fault-injection guide](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/docs/FAULT_INJECTION.md) describes these controlled tests and their prerequisites.

### Reliable asynchronous events

For events, we need to handle a lost acknowledgment as well as a lost command response.
The STM32 [event queue](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/node-api/src/NodeReliableEvents.c) stores up to 16 events and sends the oldest one until it is acknowledged.

This is stop-and-wait delivery: one event is in flight, while later events remain queued.
For example, if ACK 21 is lost, the node resends event 21, and the [host receiver](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/node_manager/HostNodeManager.c#L741) acknowledges it without publishing it twice.
The retry interval is 250 ms, with at most five sends in total: the initial send plus four retries.
On exhaustion, the event remains pending and the failure counter increase.
Same-session rediscovery preserves the host's receive cursor, preventing a lost ACK from causing duplicate publication after reconnect.

IRQ_N remains asserted while unacknowledged events are queued.
The event and ACK frames use transport sequence zero, separately from ordinary request-response matching.

That host history is another bounded buffer, and its CLI cursor is different from the node's wire-level event number.

Queue-full behaviour also needs a policy.
For actuator progress/completion, the producer keeps work pending until queue admission succeeds.
Button transitions cannot wait indefinitely, so rejected button events have a separate loss counter.
The [STM32 transport](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/NodeTransport.c#L401) handles delivery and reports these counters to the operator.

With the documented Port 2 wiring, the pinned Nordic driver cannot provide GPIO interrupts for READY and IRQ_N.
The [HostSignals adapter](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/platform/HostSignals.c) uses UART reception to wake the host and a 10 ms polling fallback for link processing.

### Supervision and fault recovery

The host uses a 500 ms request timeout, up to three retries, and a protocol heartbeat every two seconds.
The heartbeat is a UART management exchange, not an additional physical heartbeat wire.
After bounded failures, the host tries discovery again and can pulse NRST if the node remains unavailable.

The [recovery policy](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/platform/HostRecoveryPolicy.c) limits automatic resets to three within a rolling 60-second window and applies backoff—pauses between recovery attempts.
Repeated failures latch the system into a failed state instead of resetting the secondary MCU forever.
Health is reported as healthy, degraded, recovering or failed, separately from intentional modes such as maintenance.

```sh
scripts/mmctl --port "$NRF_PORT" node recovery status
scripts/mmctl --port "$NRF_PORT" --yes node recovery clear
```
{: file="Terminal: inspect and clear recovery state" }

Clearing the latch restarts discovery without replaying old operations.
Reset escalation is suppressed during maintenance, software-only shutdown, updates and ROM repair.
Shutdown in this demonstration stops simulated service work.
A communication failure never automatically asserts BOOT0 or starts rewriting firmware.

Both MCUs have local hardware watchdogs.
The [STM32 watchdog task](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/AppRtos.c#L38-L56) refreshes IWDG only after application progress advances, with a nominal timeout of about 4.1 seconds.
The [Nordic progress gate](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/platform/HostReliability.c#L54-L65) refreshes its 30-second watchdog only when both the main loop and system workqueue progress.
A failed STM32 does not stop a healthy Nordic from feeding its own watchdog and reporting the failure.

### Persistent fault information

A watchdog reset is less useful to debug if all evidence disappears with it.
The STM32 therefore has a small persistent fault journal, separate from the volatile diagnostic queue and runtime metrics.

The [portable journal](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/diagnostics/src/DiagnosticsJournal.c) defines the record and recovery algorithm, while the [application adapter](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/AppFaultHistory.c) performs the actual flash reads and writes.
It uses two dedicated 2 KiB pages, separate from application slots and boot-selection metadata.
Records include a generation number, boot count, session, firmware build, reset reason and fault details.
The generation orders journal records, and the record's timestamp is local uptime, not a shared clock between MCUs.

Each 64-byte record has a CRC and a commit marker written in its final doubleword.
Incomplete records are ignored, and rotation preserves the newest committed record while another page is erased.
Writes happen in task context, repeated faults are coalesced, and important-fault writes per boot are bounded to limit wear.
Routine sensor readings and progress events are not written to flash.
A storage failure must not prevent the node application from starting.

The journal can be read without consuming its records:

```sh
scripts/mmctl --port "$NRF_PORT" node faults list
```
{: file="Terminal: read persistent fault records" }

To clear the retained history, use:

```sh
scripts/mmctl --port "$NRF_PORT" --yes node faults clear
```
{: file="Terminal: clear persistent fault history" }

The retained-RAM boot counter and volatile host metrics should also not be confused with this persistent journal.

### Firmware updates and recovery

There are three management paths, and they solve different problems.

#### Updating Nordic

Nordic uses MCUboot and MCUmgr to receive a signed candidate into its secondary image area.
A trial boot runs the candidate, and the application confirms it after initialization and compatible node discovery.
This is available through the serial management connection.
The [installation and update guide](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/docs/FIRMWARE_UPDATES.md) includes the commands and explains the SDK development-key limitation.

#### Updating STM32 with signed A/B images

A/B means keeping two independently bootable application slots, allowing a candidate to be written without overwriting the confirmed application.
The [authoritative flash layout](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/memory/flash_layout.yaml) is:

| Region | Start address | Capacity |
|---|---|---:|
| Custom bootloader | `0x08000000` | 64 KiB |
| Application Slot 0 | `0x08010000` | 88 KiB |
| Application Slot 1 | `0x08026000` | 88 KiB |
| Metadata and reserved space | `0x0803C000` | 16 KiB |

Each slot begins with a 512-byte signed header, so its vectors start at `0x08010200` or `0x08026200`.
The applications are built for those different execution addresses, meaning a slot-0-linked image cannot simply be written to Slot 1.
Boot metadata and fault history occupy distinct pages inside the final region.

The host enters the custom bootloader and transfers a candidate into an inactive permitted slot.
After verification, the bootloader records the image as pending and starts a trial boot.
The application must confirm successful initialization before the bootloader commits the new image as confirmed.

The package uses SHA-256 for hashing and ECDSA P-256 for its signature.
The signature authenticates metadata that includes the payload hash, target, slot and execution address.
The PC validates the complete package before transfer, and [BootVerify_Slot](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/bootloader/src/BootVerify.c#L16) independently validates it on STM32 before activation.
A matching hash alone would not establish who produced the image.

The [Nordic update engine](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/bootloader/HostStmUpdate.c) forwards bounded chunks from the PC rather than holding the complete image in RAM.
It uses the separate [bootloader protocol](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/boot-protocol/src/BootProtocol.c), and update ownership pauses normal inter-MCU traffic and automatic reset escalation.
Bootloader messages have their own magic, length, sequence, offset and CRC fields, with commands for querying slots, erasing, writing chunks and finalizing an image.
Each chunk is acknowledged before the next one is sent, so transfer progress follows confirmed writes rather than assuming that UART transmission means flash programming succeeded.
A confirmed, selected or pending protected slot is rejected as an update target.

In this example, the STM32 trial self-test means reaching scheduled RTOS execution with its services initialized.
[AppBootControl](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/stm32u083/application/src/AppBootControl.c#L6) writes a backup-register confirmation marker and resets the MCU.
The bootloader, rather than the application, then commits confirmation to the flash journal.
Its trial-attempt policy can return to a valid confirmed image if the candidate does not confirm.

CRC32, SHA-256 and ECDSA run in software on STM32.

#### Repairing through the factory ROM bootloader

If the custom bootloader needs repair, Nordic raises BOOT0 and controls NRST to select the STM32 factory bootloader.
This requires the documented boot-selection option settings to have been verified on the actual board.

The UART switches to **115200 baud, 8E1**, and the [ROM protocol library](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/libraries/stm32-rom-boot/src/Stm32RomBoot.c) implements the restricted ST programming exchange.
The repair path erases and rewrites only the custom-bootloader region, checks readback, and preserves application slots and boot metadata.
It then restores BOOT0 low, normal UART settings and application discovery.

We therefore have three protocols sharing the same inter-MCU wires: application COBS framing, the custom bootloader protocol, and the factory-ROM protocol.
The [host adapter](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/firmware/nrf54l15-host/src/control/HostUpdateAdapter.c) gives only one of them ownership at a time.

> Signed images provide authenticity, not confidentiality: firmware payloads and runtime UART traffic are not encrypted.
> SWD and ROM recovery remain accessible, so they can also replace the trust root.
> Production provisioning, protection and key management require additional design.
{: .prompt-warning }

### Logging, repository structure and builds

Logging is kept separate from binary communication:

| Interface | Use |
|---|---|
| Nordic RTT | Host application logs |
| Nordic J-Link virtual COM port | PC SMP management traffic |
| STM32 ST-LINK virtual COM port | Node application logs |
| Inter-MCU UART | Runtime or bootloader messages |

The STM32 debug GPIO can be observed with UART traffic using a logic analyzer.
For example, it can mark a firmware event while the UART channels show a repeated operation request.
The [analyzer guide](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/hardware/LOGIC_ANALYZER.md) gives the exact probes and development fault exercises.
Local timestamps help correlate activity, but the MCU clocks are not globally synchronized.

The repository separates portable code, the example and board integration:

```text
libraries/                    Portable framing, node API, diagnostics,
                              image formats and bootloader protocols
examples/virtual-io/          Replaceable sensor/actuator models
firmware/nrf54l15-host/       Nordic application
firmware/stm32u083/
    application/             STM32 FreeRTOS application
    bootloader/              Independent bare-metal bootloader
    platform/                Board/HAL adapters
    memory/                  Authoritative flash layout
tools/                       CLI, signing and packaging
scripts/                     Build and test entry points
tests/                       Simulation and optional hardware runners
```
{: file="Repository layout" }

Native tests and firmware builds use the same portable library sources.
Root CMake builds native libraries and tests.
Nordic, the STM32 application and the STM32 bootloader have independent cross builds.
This keeps the project together for coordinated development without making the packages depend on one board SDK.
The [architecture guide](https://github.com/BojanSof/multi-mcu-system/blob/34b9b8112c840a281d0a6da768187e05c71edc89/docs/ARCHITECTURE.md) describes those ownership boundaries.

After completing setup, the main firmware builds run from the project root:

```sh
source ./.env.local
scripts/build/build_nordic.sh --profile reliability
scripts/build/build_stm32.sh --profile reliability
```
{: file="Terminal: build both firmwares from the project root" }

`.env.local` contains local tool paths, and `.venv` holds Python dependencies, excluded from Git.
A fresh board still needs initial bootloader provisioning and signed images, while an existing installation must reuse its trusted key and update the inactive slot.
Those are explicit steps in the installation guide, not automatic side effects of building.

### Running and verifying the demonstration

With firmware installed and `NRF_PORT` selected, a short check is:

```sh
scripts/mmctl --port "$NRF_PORT" status
scripts/mmctl --port "$NRF_PORT" node versions
scripts/mmctl --port "$NRF_PORT" node faults list
scripts/mmctl --port "$NRF_PORT" demo \
  --samples 5 --watch-seconds 10
```
{: file="Terminal: quick hardware check" }

Press the STM32 user button during the event watch.
A longer acceptance run is:

```sh
scripts/mmctl --port "$NRF_PORT" demo \
  --samples 100 --watch-seconds 600 --require-acceptance
```
{: file="Terminal: prolonged acceptance run" }

The demo checks service discovery, sensor responses, actuator progress/completion and asynchronous events.
Native and Python tests cover framing, duplicate requests, reliable delivery, journal writes and boot-state policy.

## Conclusion

A system with multiple MCUs can be a good choice when its functions already belong to separate subsystems.
However, once we split those functions between processors, communication, startup, failure handling and firmware compatibility become part of the system architecture.
They need to be considered from the beginning, together with the hardware connections.

In this demonstration, STM32 owns its local services, while Nordic discovers those services, executes requests and supervises the node.
The shared libraries define the communication contract, so the virtual sensor and actuator can be replaced with real application functions without redesigning the framing or update mechanisms.
Sequence numbers, operation IDs and sessions handle different aspects of communication, while bounded retries and watchdogs give the system a way to recover from failures.

Firmware management also needs more than transferring an image.
The system must select the correct target and slot, validate the image, handle trial boots and keep an independent recovery route available.
Signed A/B updates and factory-ROM recovery demonstrate these responsibilities, although production security and physical power-loss behaviour still require their own design and validation.

Not every project needs all of these mechanisms.
The required bandwidth, failure consequences and maintenance requirements should determine which ones are necessary.
This example uses simple UART communication and simulated peripherals and independent power switching and power savings would need additional hardware.
The useful starting point is a clear interface between the MCUs, with explicit ownership and predictable behaviour when either side is unavailable.
