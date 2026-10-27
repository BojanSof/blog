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

For more critical systems, the host can supervise the secondary MCUs by checking heartbeat signal generated by them.If heartbeat signals are missed, then the appropriate subsystem may be unhealthy.

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

The demonstration uses an nRF54L15-DK as the host and a NUCLEO-U083RC as the secondary node.

The goal is to demonstrate the infrastructure around a multi-MCU system: discovering another processor, invoking its services, handling asynchronous events, detecting failures, and managing firmware.

The STM32 provides a virtual sensor, a virtual actuator, and onboard button events.
The sensor and actuator are software simulations, so no additional electronics are needed.
Communication, watchdogs, flash programming and firmware updates run on the actual boards.

### System architecture

The system has three main components:

```
PC running mmctl
       |
       | USB / J-Link virtual COM port
       | SMP management protocol
       v
nRF54L15 host
       |
       | UART + supervisory GPIOs
       v
STM32U083 node
       ├── FreeRTOS application
       ├── Custom signed A/B bootloader
       └── Factory ROM bootloader
```

The Nordic application runs on Zephyr RTOS through nRF Connect SDK.
It owns discovery, request scheduling, supervision and firmware-update orchestration.

The STM32 application uses STM32 HAL and FreeRTOS.
It owns local services and executes operations independently.
Its custom bootloader is a separate bare-metal application.

The PC CLI, `mmctl`, is used to operate the system.
It communicates with Nordic using [SMP](https://docs.zephyrproject.org/latest/services/device_mgmt/smp_protocol.html) and [CBOR](https://cbor.io/), while Nordic uses a separate protocol to communicate with STM32.
On this development board, the PC connection passes through the J-Link debugger’s USB-to-UART bridge.

### Physical interface and control signals

The inter-MCU link uses UART at 115200 baud, 8N1, without RTS/CTS flow control.

UART provides enough bandwidth for the demonstrated commands and events.
It also allows the same STM32 UART pins to be reused for factory-ROM recovery.

The complete interconnect is:

| Signal | Nordic GPIO | STM32 connection | Purpose |
|---|---|---|---|
| Host TX → node RX | P1.11 | PA10 | Commands and update data |
| Node TX → host RX | P1.12 | PA9 | Responses and events |
| READY | P2.06 | PB5 | Application initialized and available |
| IRQ_N | P2.08 | PB4 | Active-low pending-event indication |
| RESET | P1.08 | NRST | Host-controlled node reset |
| BOOT0 | P1.14 | BOOT0 | Select factory-ROM recovery |
| GND | GND | GND | Common signal reference |

RESET is open-drain and Nordic either pulls it low or releases it.
BOOT0 stays low during normal operation and is raised only for an explicit factory-ROM recovery operation.

Two things are important to note:

- the Nordic board by default uses 1.8 V I/O supply, therefore it needs to be configured for 3.3 V using the [nRF Connect for Desktop](https://www.nordicsemi.com/Products/Development-tools/nRF-Connect-for-Desktop) application,
- the boards power are powered independently and there is no proper power control, so in this example it is important first to power Nordic board, then power the STM board.

### Inter-MCU communication protocol

The byte-to-byte protocol definition for inter-MCU communication is implemented in a portable C library.
The framing implemented in this library is as follows:

```
COBS(header + payload + CRC32) + 0x00
```

[COBS](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing) encoding ensures that zero does not occur inside an encoded frame.
The zero byte therefore marks a frame boundary and gives the parser a resynchronization point after malformed input.

The decoded frame contains:

| Field | Size | Purpose |
|---|---:|---|
| Magic | 2 bytes | Identify the protocol |
| Wire major version | 1 byte | Framing compatibility |
| Message kind | 1 byte | Request, response or event |
| Flags | 1 byte | Includes response-error indication |
| Sequence number | 2 bytes | Match requests and responses |
| Payload length | 2 bytes | Validate payload bounds |
| Payload | Up to 243 bytes | Management or service data |
| CRC32 | 4 bytes | Detect accidental corruption |

All multibyte fields are explicitly encoded little-endian.
The encoder writes individual fields rather than transmitting a C structure:

```c
Protocol_WriteUint16(&decoded[0], PROTOCOL_MAGIC);
decoded[2] = PROTOCOL_WIRE_VERSION_MAJOR;
decoded[3] = (uint8_t)frame->kind;
decoded[4] = frame->flags;
Protocol_WriteUint16(&decoded[5], frame->sequence);
Protocol_WriteUint16(&decoded[7], frame->payload_length);
```

After copying the payload, it calculates the CRC over the header and payload:

```c
decoded_length = PROTOCOL_HEADER_SIZE + frame->payload_length;
crc = Protocol_CalculateCrc32(decoded, decoded_length);
Protocol_WriteUint32(&decoded[decoded_length], crc);
decoded_length += PROTOCOL_CRC_SIZE;
```

Explicit serialization avoids dependencies on compiler padding, alignment and native byte order.

The receiver accepts partial frames and multiple frames arriving together.
It checks lengths, versions and CRCs before dispatching messages.
Malformed frames are rejected without changing application state.

### Discovering the node and its services

The host does not assume that every connected node implements the same functionality.
Startup follows this exchange:

```
STM32                                Nordic
  |                                     |
  |---- READY becomes high ------------>|
  |<--- HELLO --------------------------|
  |---- session and API versions ------>|
  |<--- GET_IDENTITY -------------------|
  |---- node identity ----------------->|
  |<--- GET_CAPABILITIES ---------------|
  |---- capability bitmap ------------->|
  |<--- negotiate reliable events ------|
  |<--- LIST_SERVICES ------------------|
  |---- service descriptors ----------->|
  |                                     | ONLINE
```

Reliable-event negotiation is optional and happens only when both sides support it.

Application functionality is exposed through a service registry:

| Service | ID | Function |
|---|---|---|
| GPIO events | 0x0001 | Report onboard button changes |
| Diagnostics | 0x0002 | Fault records and development injections |
| Lifecycle | 0x0003 | Versions, operating modes and fault history |
| Virtual sensor | 0x1001 | Return deterministic integer samples |
| Virtual actuator | 0x1002 | Execute a timed operation with progress |

Each service has a version and a handler. Registration associates its public descriptor with an implementation:

```c
registration.descriptor.service_id = VIRTUAL_IO_SENSOR_SERVICE_ID;
registration.descriptor.version_major = VIRTUAL_IO_VERSION_MAJOR;
registration.descriptor.version_minor = VIRTUAL_IO_VERSION_MINOR;
registration.descriptor.flags = 0U;
registration.handler = VirtualIo_SensorHandler;
registration.context = instance;

status = NodeApi_RegisterService(registry, &registration);
```

One node personality exposes the sensor, while another adds the actuator.

Firmware versions and interface versions are separate.
Two different firmware releases can communicate as long as their required interfaces remain compatible.

### Example: requesting a sensor sample

From the project root, the operator can list services and request a sample:

```sh
scripts/mmctl --port "$NRF_PORT" services
scripts/mmctl --port "$NRF_PORT" sensor sample
```

Here, NRF_PORT identifies the Nordic J-Link virtual COM port.

Nordic translates the PC request into an inter-MCU service call. For an illustrative session 0x12345678 and operation 7, the application payload is:

```
00 01          SERVICE_CALL message
78 56 34 12    Current session
01 10          Virtual sensor service: 0x1001
01 00          Sample command: 0x0001
07 00 00 00    Operation ID: 7
```

The outer frame adds its sequence number, length, CRC and COBS encoding.

The sensor handler generates a deterministic value for a given seed and sample index:

```c
mixed = instance->seed +
        (instance->sample_index * 1664525U) +
        1013904223U;

sample = (int32_t)(mixed % 2001U) - 1000;

VirtualIo_WriteU32(&response->data[0], (uint32_t)sample);
VirtualIo_WriteU32(&response->data[4], instance->sample_index);
```

The response contains a signed value in milli-units and a sample index.

Integer units keep the representation explicit and avoid floating-point dependencies. Deterministic simulation makes the service easy to test without hardware peripherals.

### Example: asynchronous actuator execution

Some operations take longer than a single request-response exchange.

For example:

```sh
scripts/mmctl --port "$NRF_PORT" actuator start --duration-ms 2000
```

The actuator accepts the operation immediately, then reports progress:

```
Host                                      Node
 |-- START operation=8 -------------------->|
 |<-- Accepted, execution=1 ----------------|
 |                                          |
 |<-- Progress 25%, operation=8 ------------|
 |-- Sensor sample request ---------------->|
 |<-- Sensor sample response ---------------|
 |<-- Progress 50%, operation=8 ------------|
 |<-- Progress 75%, operation=8 ------------|
 |<-- Complete, operation=8 ----------------|
```

The command handler initializes the operation and returns. Periodic processing advances it using elapsed time, without sleeping inside the handler until completion.

This separates two meanings that should not be confused:

- Accepted: the node has admitted the operation.
- Completed: the requested operation has finished.

Other service requests can run while the actuator operation is active.

### Retries and duplicate execution

A missing response does not necessarily mean that the node missed the command. The node may have executed it successfully while the response was lost.

The protocol therefore distinguishes three identifiers:

| Identifier | Meaning |
|---|---|
| Sequence number | A particular request-response exchange |
| Operation ID | A logical operation and its later events |
| Session | The current node generation |

Consider a lost acceptance response:

```
Host                                      Node
 |-- START operation=8 -------------------->|
 |                                          | Starts execution 1
 |<-- Accepted, execution=1 ----- X lost    |
 |                                          |
 |-- Retry START operation=8 -------------->|
 |<-- Accepted, execution=1 ----------------|
```

The actuator checks its operation history before starting another execution:

```c
if (VirtualIo_FindOperation(instance, request->operation_id,
                            &execution)) {
    VirtualIo_WriteU32(response->data, execution);
    response->data_length = VIRTUAL_IO_ACTUATOR_START_RESPONSE_SIZE;
    return NODE_API_STATUS_OK;
}
```

The generic service layer also caches its most recent successful request and response, including the argument bytes.

These caches are bounded and volatile. They prevent common retry duplicates, but do not guarantee exactly-once execution across arbitrary resets or power loss.

The PC interface has similar protection: request IDs are checked within the current Nordic boot. The CLI does not blindly replay a mutating command after the host restarts.

### Reliable asynchronous events

The final implementation adds acknowledged events while preserving compatibility with older firmware.

The STM32 keeps a fixed queue of 16 events. Each admitted event receives a session-scoped event number:

```
STM32                                     Nordic
 |-- Event 21 ---------------------------->|
 |                                         | Admits event to local history
 |<-- ACK 21 ------------------------------|
 |                                         |
 |-- Event 22 ---------------------------->|
```

Delivery uses stop-and-wait: the oldest event is acknowledged before the next one is transmitted. If an acknowledgment is lost, the node retransmits the same event number, and the host acknowledges it without publishing it twice.

The retry interval is 250 ms, with at most five sends before reporting exhaustion. Pending events remain retained, and explicit renegotiation can rearm delivery.

IRQ_N stays asserted while unacknowledged events remain. An acknowledgment means that Nordic admitted the event into its bounded history; it does not mean that the PC has consumed it.

Queue pressure is handled explicitly. Actuator completion remains pending at its producer until queue admission succeeds. Button-event loss is counted separately.

#### A hardware detail that caused a real bug

The READY and IRQ signals are connected to Nordic Port 2. In the pinned SDK, that GPIO controller has no GPIOTE instance, so requesting GPIO interrupts returns -ENOTSUP.

Initially, this optional interrupt-setup failure aborted startup before the host control subsystem was initialized. The PC could still reach the SMP server, but status showed a zero host boot ID and unavailable update support.

The correction keeps required GPIO configuration errors fatal while treating unsupported interrupt setup as a warning. UART reception wakes the host, with a 10 ms polling fallback for link processing.

Consequently, this status is expected with the current wiring:

```json
{
  "gpio_interrupts": false,
  "health": "healthy",
  "watchdog": true
}
```

The electrical IRQ signal still indicates pending events. The host simply does not receive GPIO interrupts from that pin configuration.

### Supervision and fault recovery

The host uses request timeouts, bounded retries and a protocol heartbeat every two seconds.

If communication fails, it first tries rediscovery. If the node remains unavailable, it can pulse NRST and wait for the application to return.

Automatic reset attempts are bounded to three within a rolling 60-second window, with backoff between attempts. Repeated failure latches a failed state instead of causing an endless reset loop.

The operator can inspect and clear that state:

```sh
scripts/mmctl --port "$NRF_PORT" node recovery status
scripts/mmctl --port "$NRF_PORT" --yes node recovery clear
```

Recovery is suppressed during intentional maintenance, shutdown, updates and ROM repair. A communication failure never automatically selects BOOT0 or starts rewriting firmware.

Both MCUs also have hardware watchdogs:

- STM32 refreshes its watchdog only while application progress advances.
- Nordic refreshes its 30-second watchdog only when both the main loop and system workqueue progress.

The Nordic watchdog does not depend on STM32 being online. A failed secondary MCU should not prevent the host from reporting the problem.

### Persistent fault information

Runtime logs are useful, but they disappear when the MCU resets. The STM32 therefore has a small persistent fault journal.

It occupies two dedicated 2 KiB flash pages, separate from application slots and boot-selection metadata. Records include boot count, session, firmware build, reset reason and fault correlation information.

Each 64-byte record has a CRC and a final commit marker. An incomplete write is ignored during recovery. Page rotation preserves the newest committed data, and clearing history uses a committed logical marker.

Writes happen from task context. Routine sensor readings and progress events are not written to flash. Repeated faults are coalesced, and the number of fault writes per boot is bounded to limit wear.

The CLI exposes non-destructive reads:

```sh
scripts/mmctl --port "$NRF_PORT" node faults list
```

In the hardware test, the first two journal generations remained visible after resetting STM32, and a third record appeared for the new boot and session. This verified warm-reset retention.

Clearing the journal requires explicit authorization:

```sh
scripts/mmctl --port "$NRF_PORT" --yes node faults clear
```

This is a logical clear, not secure physical erasure.

### Firmware updates and recovery

Firmware management has three distinct paths.

#### Updating Nordic

Nordic uses MCUboot and MCUmgr. A signed image can be uploaded through the serial management interface, trial-booted and confirmed after application checks.

The demonstrated update transport is serial. BLE updates are not implemented in this project.

#### Updating STM32 with signed A/B images

The STM32 flash layout is:

| Region | Address | Capacity |
|---|---|---:|
| Custom bootloader | 0x08000000 | 64 KiB |
| Application Slot 0 | 0x08010000 | 88 KiB |
| Application Slot 1 | 0x08026000 | 88 KiB |
| Metadata and reserved space | 0x0803C000 | 16 KiB |

Each slot contains a signed header followed by its application. The applications are linked separately for their respective execution addresses; they are not assumed to be position-independent.

A normal update follows this sequence:

```
PC validates signed package
        ↓
Nordic enters STM custom bootloader
        ↓
Inactive slot is erased and programmed
        ↓
STM validates image hash and signature
        ↓
Image becomes pending
        ↓
Trial application boots and self-tests
        ↓
Confirmation is committed, or boot policy rolls back
        ↓
Nordic rediscovers the running application
```

Packages use SHA-256 and ECDSA P-256 signatures. The PC validates the complete package before transfer, and the STM32 bootloader independently validates it before activation.

Nordic forwards bounded chunks instead of holding the entire STM32 image in RAM. During this operation, the update engine exclusively owns the inter-MCU UART.

The bootloader has its own binary protocol, separate from the application’s COBS protocol.

The target must be the inactive slot. Trying to update a protected confirmed, selected or pending slot is rejected rather than erasing it.

Upload completion is also different from update completion: verification, trial boot, confirmation and rediscovery still take time afterward.

#### Repairing through the factory ROM bootloader

If the custom STM32 bootloader needs repair, Nordic controls BOOT0 and RESET to enter the factory bootloader.

It switches the UART to 115200 baud, 8E1 and uses ST’s ROM protocol. The repair operation rewrites the custom-bootloader region while preserving application slots and boot metadata.

It then restores BOOT0, normal UART settings and application discovery.

These are three different STM32 UART modes: application protocol, custom-bootloader protocol and factory-ROM protocol. Only one owns the UART at a time.

Signed images do not make this demonstration a production-secured platform. SWD and ROM recovery remain accessible, and production provisioning and device protection require additional work.

### Logging and repository structure

Logs are separated from binary communication:

| Interface | Use |
|---|---|
| Nordic RTT | Host application logs |
| Nordic J-Link virtual COM port | PC management traffic |
| STM32 ST-LINK virtual COM port | Node application logs |
| Inter-MCU UART | Runtime or bootloader messages |

A STM32 debug GPIO is available for observing firmware events alongside UART traffic with a logic analyzer.

The repository separates reusable code from board integration:

```
libraries/
    protocol/
    node-api/
    diagnostics/
    firmware-image/
    boot-protocol/
    stm32-rom-boot/

examples/
    virtual-io/

firmware/
    nrf54l15-host/
    stm32u083/
        application/
        bootloader/
        platform/

tools/
scripts/
tests/
```

Portable libraries use C11 and have native tests. Nordic, STM32 application and STM32 bootloader builds remain independent. The virtual-I/O example can be replaced without moving application-specific behavior into the protocol libraries.

### Running and verifying the demonstration

The reliability firmware builds from the project root:

```sh
source ./.env.local

scripts/build/build_nordic.sh --profile reliability
scripts/build/build_stm32.sh --profile reliability
```

STM32 slot images must then be signed with the key matching the installed bootloader and installed into the inactive slot.

After installation, a short demonstration is:

```sh
scripts/mmctl --port "$NRF_PORT" status
scripts/mmctl --port "$NRF_PORT" node faults list

scripts/mmctl --port "$NRF_PORT" demo \
  --samples 5 --watch-seconds 10
```

Pressing the STM32 user button during the watch produces asynchronous events.

The longer acceptance run is:

```sh
scripts/mmctl --port "$NRF_PORT" demo \
  --samples 100 --watch-seconds 600 --require-acceptance
```

Hardware testing confirmed normal signed updates, healthy host startup, sensor requests, actuator progress and completion, button events, and journal retention through a node reset. The prolonged acceptance run also passed.

The short reliability run measured a median PC-to-node request latency of approximately 86 ms, with no protocol errors, UART errors, retries or reliable-event gaps during the run.

The software verification included 26 native tests, two bootloader tests and 331 Python tests. These cover framing, malformed input, duplicate handling, event retries, journal interruption boundaries and boot-state behavior.

Hardware tests for deliberate watchdog expiry, exhausted automatic recovery, power-cycle retention and interrupted-update rollback remain separate acceptance steps. Native simulation provides useful coverage for those cases, but it cannot replace testing actual flash, reset and power behavior on the boards.
