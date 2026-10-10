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
