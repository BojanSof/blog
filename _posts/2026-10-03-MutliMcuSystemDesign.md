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

# Practical examples of multi-MCU systems

To illustrate the problem, it is good to share some practical applications that benefit from multi-MCU design.

## nRF54L15 + STM32N6 (BLE low power sensing + camera)

## Battery-powered smart camera sensor

Whether it is for industrial monitoring application, wildlife capture or some kind of wearable device that captures photos when sensors detect something, this is good candidate for multi-MCU system.
Practical choice of components may include Nordic nRF54L15 BLE module, which is the low-power MCU, running most of the time, sampling sensors and sending data and statistics over BLE, while we can have higher-performance STM32N6 MCU, which has MIPI CSI-2 interface and image signal processing (ISP) module, so one can connect higher resolution camera sensor to it, and get higher quality images and run some vision AI model on it, such as object detection model.
Once the sensors which are samples on the nRF54L15 detect specific event (such as motion detected using PIR sensor, or vibration analysis using IMUs), the STM32N6 MCU can be powered-on, capture photo, run the vision AI model if required and be powered-off.
To ensure operations get done as quickly as possible, using SPI physical connection between the MCUs (Nordic is master, STM is slave) is the preferred choice, along with some kind of interrupt/handshake pin for STM to notify the Nordic chip when it has some data available.
This is typical scenario of dividing specific tasks, because of peripheral availability (MIPI CSI-2 interface, ISP pipeline are available on the STM chip) and power management (Nordic is low-power, can handle sensors and communication, while STM only gets powered on when needed).

## Smart appliances - washing machine

If we take the example of modern smart washing machine, we can separate the tasks of the washing machine in two parts:

1. The main logic for driving the motor, controlling the water pump, the draining system, the door, error control, etc.;
2. The UI of the washing machine, including the rotary encoder for program selection, the display, potentially the WiFi module it has for remote control.

These functions can be separated and handled by two MCUs, that may have different set of peripherals as their required functionalities are different.

# Difficulties managing multi-MCU systems

Managing system with multiple MCUs has its difficulties.
The main reason for this is that the system is not controlled by single firmware anymore, instead every MCU in the system has its own state, timing, firmware version, behaviour and responsibilities, so the system behaves like small distributed system.
We are going to list the most important challenges and provide ways to handle them.
It is important to understand that all the difficulties are manageable, but they should be treated as part of the system design, rather than think how to resolve them later.

## Inter-MCU communication

The MCUs must communicate between each other, so they need clearly defined protocol for exchanging commands, events, status and data.
This includes choosing the physical interface for communication, such as I2C, SPI, UART or something else, and also defining the protocol that runs on top of it.
This is probably the most important interface to design, as it will make it easier to develop each subsystem and prevent complexity from spreading throughout the rest of the firmware.

## Ownership of responsibilities

It should be clear what every MCU does and which functions it handles.

## Startup and shutdown sequencing

The MCUs may not boot at the same time, and in most cases one MCU controls the power of another MCUs.
Therefore, the system should define what happens if one MCU is still booting, is powered off, restarting or temporarily unavailable.

## Failure handling

There are many failures that can happen, such as communication timeouts, corrupted messages, crashed firmware, watchdog resets and all of them need predictable behaviour.

## Firmware compatibility

It is important for MCUs to run compatible firmware between them.
Typically, this is bound to the communication protocol, so proper protocol versioning and backwards compatibility should be planned.

## Firmware updates

Updating the firmware in system with multiple MCUs raises questions such as which MCU controls the update procedure, in which order are the MCUs updated, how rollback works and what happens if power is lost throughout the process.

## Debugging

Debugging system with multiple MCUs poses some challenges, as bugs may depend on the timing and interactions between the MCUs.

## Repository and build management

The firmware project for each MCU typically has its own SDK, toolchain and build system, but it also depends on shared protocol library.
This does raise few question how to manage the projects in synchronized manner.
