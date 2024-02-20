---
title: Python Device Development Toolkit
date: 2024-02-20
categories: [Electronics, Embedded Systems, Software]
tags: [electronics, embedded, software, python]
math: true
# image:
#   path: /assets/img/python-dev-devel/cover.webp
---

Embedded systems play a crucial role in powering modern devices, integrating hardware and software to perform a wide range of tasks.
Often, these devices include one or more [sensors](https://en.wikipedia.org/wiki/Sensor), used for converting physical quantity to a signal which can be processed by microcomputer system.
There is a large number of sensors available, for sensing:
- temperature,
- pressure,
- humidity,
- different kinds of gasses,
- vibrations,
- acceleration,
- electric fields,
- magnetic fields,
- distance,
- light, and many more.

The microcomputer system can be microcontroller consisting of hardware peripherals which are often used to interface with many kinds of sensors, while also allow for quite flexible firmware development.
These hardware peripherals most of the times implement many communication protocols, including the serial [I<sup>2</sup>C](https://en.wikipedia.org/wiki/I%C2%B2C), [SPI](https://en.wikipedia.org/wiki/Serial_Peripheral_Interface), and [UART](https://en.wikipedia.org/wiki/Universal_asynchronous_receiver-transmitter) protocols, but also allow to implement parallel communication protocols.
They also include analog-to-digital and digital-to-analog convertes(ADCs and DACs).
The former are used to interface sensors that provide digital interfaces, and the latter provide ability to read and interface sensors which provide or require analog signals.

In practice, the purpose of the devices is to collect the sensor data, process it and derive unique information.
For example, let's say we want to design device for controlling a fan based on temperature.
We can realize such system by utilizing temperature sensor connected to a microcontroller which reads-out the current temperature, checks if the temperature is above some threshold value and if it is, turns on the fan.
The processing step in this system is quite simple: check if the temperature is above some threshold value.
What we may need is to check if the temperature readings are correct and calibrated, so we must provide a way to obtain the readings, for example on a computer.
We can utilize simple serial communication to visualize the temperature data in real-time or we can simply show it in a serial console.

The question is, what can we use to get the data?

If we assume that the microcontroller is sending the data over UART, on the computer we can use USB-to-UART convertor which allows the computer to read the UART data over USB.
Fortunately, there are many softwares for reading data sent in this way, like the Serial Monitor and Plotter in [Arduino IDE](https://www.arduino.cc/en/software), [Putty](https://www.putty.org/), [SerialPlot](https://hackaday.io/project/5334-serialplot-realtime-plotting-software), [Better Serial Plotter](https://hackaday.io/project/181686-better-serial-plotter), and many more which are not listed.
These softwares generally require the data to be formated in some predefined formats, for example numbers written as ASCII strings and separated with a delimiter, like `,`, which often is good enough for testing the device, but eventually it may be required to create custom data serialization format (protocol).

Aside from UART, devices often use Bluetooth, Bluetooth Low Energy (Bluetooth LE, BLE), TCP/IP and USB protocols.
In such cases, it is a bit hard to find software already created for our purpose and it is required to create a custom software for interfacing our device.
This software is required for providing it to users and customers and can be computer or mobile application running on Android or iOS device.
However, development of such software can be long process and it will probably block the development and testing of the device.

Thankfully, we have Python which is full of libraries for easy implementation of many communication protocols, libraries for numeric and scientific computations, digital signal processing, machine learning and deep learning algorithms.
The goal of this post is to describe how we can utilize Python to create customized softwares for interfacing devices, real-time visualization of the data coming from the device, collecting such data, but also processing and deriving information from such data, even in real-time.