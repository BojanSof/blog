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
There is a large number of sensors available, for sensing temperature, pressure, humidity, different kinds of gasses, vibrations, acceleration, electric fields, magnetic fields, distance, light, and many more.

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

We are going to use dev board for [ESP32-S3](https://www.espressif.com/en/products/socs/esp32-s3), multiprotocol SoC which implements Wi-Fi and BLE protocols.
We will show examples by utilizing Wi-Fi, BLE and USB serial communication to read-out Intertial Measurement Unit ([MPU6050](https://invensense.tdk.com/products/motion-tracking/6-axis/mpu-6050/)) connected to the dev board and apply processing to the data.

> All the code used in this post can be found on [this](dummy) GitHub repo. However, the code for the ESP32 won't be explained, as it is not the main topic of the post.
{: .prompt-info }

## Accessing device data

The first step for developing the software is establishing connection with the device.
As mentioned previously, there are multiple protocols that the device can utilize to communicate with another device, for example computer or mobile phone.
This post concentrates on 2 protocols used for communication between the device that we are developing and another device that should utilize the data: USB communication and Bluetooth Low Energy.
There are few well-developed Python libraries which allow cross-platform usage of these protocols.

### USB

By USB communication it is assumed that the USB controller of the device is configured as Communication Device Class (CDC) and the device communicate in same manner as via UART.
[PySerial](https://pyserial.readthedocs.io/en/latest/index.html) is Python library that encapsulates the access to the serial port, and works on multiple platforms, including Windows, Linux and MacOS.
The [short introduction](https://pyserial.readthedocs.io/en/latest/shortintro.html) demonstrates the basic usage of the library.

We can write class `Serial` that can allow us to easily receive the data from the serial port.

```python
import threading

import serial
import serial.tools.list_ports as ports


class Serial:
    def __init__(self):
        self.port = None
        self.data_thread_stop_event = threading.Event()
        self.data_thread = None
        self.on_data = None

    def get_found_devices(self):
        com_ports = ports.comports()
        return [com_port.device for com_port in com_ports]

    def open(self, port, on_data, **port_kwargs):
        self.port = serial.Serial(port=port, **port_kwargs)
        if not self.port.is_open:
            self.port = None
            return False
        else:
            self.on_data = on_data
            self.data_thread = threading.Thread(
                target=self._data_read,
                args=(self.port, self.data_thread_stop_event),
            )
            self.data_thread.start()
            return True

    def close(self):
        if self.port is not None:
            self.data_thread_stop_event.set()
            self.data_thread.join()
            self.port.close()
            self.port = None
            self.on_data = None
            return True
        return False

    def is_open(self):
        if self.port is not None:
            return self.port.is_open
        return False

    def _data_read(self, port, stop_event):
        while not stop_event.is_set() and port.is_open:
            data = port.read_all()
            if len(data) > 0:
                self.on_data(data)
```

The `Serial` class allows us to list the current serial ports connected to the computer, and also open, close and read port data.
When openning the port, the user provides callback that is called each time new data is received.
The reading of the port data is done in a separate thread, which constantly reads all currently available data on the port and calls the user-provided callback function.

### Bluetooth Low Energy

[Bleak](https://bleak.readthedocs.io/en/latest/) is probably the best cross-platform BLE Python library.
The [usage](https://bleak.readthedocs.io/en/latest/usage.html) page of the docs demonstrates the basic usage of the library.
As the library utilizes [asynchronous I/O](https://docs.python.org/3/library/asyncio.html), it may be a bit difficult for novice developers to incorporate it in their projects.

We can write `Ble` class that will allow us to easily utilize the BLE module:

```python
import asyncio
import enum
import threading

from bleak import BleakScanner, BleakClient


class BleStatus(enum.Enum):
    Connecting = enum.auto()
    Connected = enum.auto()
    Disconnecting = enum.auto()


class BleDevice:
    def __init__(self, name, address, rssi, uuids, manufacturer_data):
        self.name = name
        self.address = address
        self.rssi = rssi
        self.uuids = uuids
        self.manufacturer_data = manufacturer_data
        self._device_hndl = None
        self._client = None

    def __str__(self):
        return self.name if self.name is not None else ""


class BleCharacteristic:
    def __init__(self, uuid, properties):
        self.uuid = uuid
        self.properties = properties


class BleService:
    def __init__(self, uuid, characteristics):
        self.uuid = uuid
        self.characteristics = characteristics


class Ble:
    def __init__(self):
        self.found_devices = {}
        self.on_device = None
        self.scanning = False
        self.scan_stop_event = asyncio.Event()

        self.on_connect = {}
        self.on_disconnect = {}
        self.status_devices = {}
        self.disconnect_events = {}
        self.connected_devices = {}

        self.event_loop = asyncio.new_event_loop()
        self.event_loop_thread = threading.Thread(
            target=self._asyncloop, daemon=True
        )
        self.event_loop_thread.start()

    def __del__(self):
        for dev in self.connected_devices.values():
            self.disconnect(dev)
        self.event_loop.call_soon_threadsafe(self.event_loop.stop)
        self.event_loop_thread.join()

    def start_scan(self, on_device):
        self.found_devices = {}  # clear previously found devices
        self.on_device = on_device
        self.scan_stop_event.clear()
        asyncio.run_coroutine_threadsafe(
            self._bluetooth_scan(self.scan_stop_event), self.event_loop
        )
        self.scanning = True

    def stop_scan(self):
        if self.scanning:
            self.event_loop.call_soon_threadsafe(self.scan_stop_event.set)
            self.scanning = False

    def is_scanning(self):
        return self.scanning

    def get_found_devices(self):
        return list(self.found_devices.values())

    def connect(self, dev, on_connect, on_disconnect):
        if not self.is_connected(dev):
            if on_connect is not None:
                self.on_connect[dev.address] = on_connect
            if on_disconnect is not None:
                self.on_disconnect[dev.address] = on_disconnect
            self.disconnect_events[dev.address] = asyncio.Event()
            self.status_devices[dev.address] = BleStatus.Connecting
            asyncio.run_coroutine_threadsafe(
                self._bluetooth_connect(
                    dev, self.disconnect_events[dev.address]
                ),
                self.event_loop,
            )

    def disconnect(self, dev):
        if self.is_connected(dev):
            self.status_devices[dev.address] = BleStatus.Disconnecting
            self.event_loop.call_soon_threadsafe(
                self.disconnect_events[dev.address].set
            )

    def is_connected(self, dev):
        return dev.address in self.connected_devices

    def get_connected_devices(self):
        return list(self.connected_devices.values())

    def get_status(self, dev):
        if dev.address in self.status_devices:
            return self.status_devices[dev.address]
        else:
            return None

    def get_services_and_characteristics(self, dev):
        if not self.is_connected(dev):
            services_collection = None
        else:
            services_collection = []
            client = self.connected_devices[dev.address]._client
            for _, service in client.services.services.items():
                service_characteristics = []
                for characteristic in service.characteristics:
                    ble_characteristic = BleCharacteristic(
                        uuid=characteristic.uuid,
                        properties=characteristic.properties,
                    )
                    service_characteristics.append(ble_characteristic)
                ble_service = BleService(
                    uuid=service.uuid, characteristics=service_characteristics
                )
                services_collection.append(ble_service)
        return services_collection

    def read_characteristic(self, dev, char_uuid):
        if self.is_connected(dev):
            client = self.connected_devices[dev.address]._client
            chars = list(client.services.characteristics.values())
            chars_uuids = [char.uuid for char in chars]
            chars_properties = [char.properties for char in chars]
            if char_uuid in chars_uuids:
                i_char = chars_uuids.index(char_uuid)
                if "read" in chars_properties[i_char]:
                    future = asyncio.run_coroutine_threadsafe(
                        self._bluetooth_read(client, char_uuid),
                        self.event_loop,
                    )
                    return future.result()
        return None

    def write_characteristic(self, dev, char_uuid, data, response):
        if self.is_connected(dev):
            client = self.connected_devices[dev.address]._client
            chars = list(client.services.characteristics.values())
            chars_uuids = [char.uuid for char in chars]
            chars_properties = [char.properties for char in chars]
            if char_uuid in chars_uuids:
                i_char = chars_uuids.index(char_uuid)
                prop = "write" if response else "write-without-response"
                if prop in chars_properties[i_char]:
                    future = asyncio.run_coroutine_threadsafe(
                        self._bluetooth_write(
                            client, char_uuid, data, response
                        ),
                        self.event_loop,
                    )
                    return future.result()
        return None

    def start_notifications(self, dev, char_uuid, on_data):
        if self.is_connected(dev):
            client = self.connected_devices[dev.address]._client
            chars = list(client.services.characteristics.values())
            chars_uuids = [char.uuid for char in chars]
            chars_properties = [char.properties for char in chars]
            if char_uuid in chars_uuids:
                i_char = chars_uuids.index(char_uuid)
                if "notify" in chars_properties[i_char]:
                    asyncio.run_coroutine_threadsafe(
                        self._bluetooth_start_notify(
                            client, char_uuid, on_data
                        ),
                        self.event_loop,
                    )
                    return True
        return False

    def stop_notifications(self, dev, char_uuid):
        if self.is_connected(dev):
            client = self.connected_devices[dev.address]._client
            chars = list(client.services.characteristics.values())
            chars_uuids = [char.uuid for char in chars]
            chars_properties = [char.properties for char in chars]
            if char_uuid in chars_uuids:
                i_char = chars_uuids.index(char_uuid)
                if "notify" in chars_properties[i_char]:
                    asyncio.run_coroutine_threadsafe(
                        self._bluetooth_stop_notify(client, char_uuid),
                        self.event_loop,
                    )
                    return True
        return False

    async def _bluetooth_scan(self, stop_event):
        async with BleakScanner(
            detection_callback=self._detection_callback,
        ):
            await stop_event.wait()

    def _detection_callback(self, device, advertisement_data):
        dev = BleDevice(
            name=advertisement_data.local_name,
            address=device.address,
            rssi=advertisement_data.rssi,
            uuids=advertisement_data.service_uuids,
            manufacturer_data=advertisement_data.manufacturer_data,
        )
        dev._device_hndl = device
        self.found_devices[device.address] = dev
        if self.on_device is not None:
            self.on_device(dev)

    async def _bluetooth_connect(self, device, disconnect_event):
        async with BleakClient(
            device._device_hndl,
            self._disconnect_callback,
        ) as client:
            device._client = client
            self.connected_devices[client.address] = device
            self.status_devices[client.address] = BleStatus.Connected
            if client.address in self.on_connect:
                self.on_connect[client.address]()
            await disconnect_event.wait()
            del self.disconnect_events[client.address]

    def _disconnect_callback(self, client):
        if client.address in self.disconnect_events:
            self.disconnect_events[client.address].set()
        del self.connected_devices[client.address]
        del self.status_devices[client.address]
        if client.address in self.on_connect:
            del self.on_connect[client.address]
        if client.address in self.on_disconnect:
            self.on_disconnect[client.address]()
            del self.on_disconnect[client.address]

    async def _bluetooth_read(self, client, uuid):
        return await client.read_gatt_char(uuid)

    async def _bluetooth_write(self, client, uuid, data, response):
        return await client.write_gatt_char(uuid, data, response)

    async def _bluetooth_start_notify(self, client, uuid, on_data):
        await client.start_notify(uuid, lambda _, data: on_data(data))

    async def _bluetooth_stop_notify(self, client, uuid):
        await client.stop_notify(uuid)

    def _asyncloop(self):
        asyncio.set_event_loop(self.event_loop)
        self.event_loop.run_forever()
```

To make it possible to use bleak functionalities in regular sync code, new thread is created which executes `asyncio` event loop.
The idea is to submit the coroutines based on bleak code in the event-loop executing in this new thread.
Then, the user can use regular functions to utilize BLE communication.

The class contains methods for discovering BLE devices, connecting to BLE devices and performing BLE operations on connected devices.

To start the discovering process, `start_scan` function can be called, which optionally accepts user-provided callback function that is called any time new BLE device is discovered or advertisement data of already found device is changed.
To stop the discovery process, `stop_scan` can be used.
Obtaining list of all the discovered devices can be done in any moment using `get_found_devices`.

After the discovery process is done, we can connect to a discovered device.
For that purpose, we use the `connect` function, which needs to be provided with a device obtained with the discovery process, and optionally callback functions can be passed that will be called on connect or on disconnect.
The state of the connection with a specific device can be checked by calling `get_status` with the device as parameter.
State of the connection can be `Connecting`, `Disconnecting` or `Connected`.

After connection is established, we can perform BLE operations with the device.
We can obtain list of all the services and characteristics of the device by calling `get_services_and_characteristics`, which returns a list of `BleService` objects.
There are functions for reading and writing characteristic, `read_characteristic` and `write_characteristic`, which need the UUID of the characteristic that we want to perform the operation on.
It is also possible to start notifications on a given characteristic, by calling `start_notifications`, which accepts callback function which is called when new data is received from the device.

### Simulated device

When developing the software, it is good if we can develop some parts of it without need of external device.
In our case, we can develop the real-time plotting part without relying on external device.
Instead, we will create simulated device.
The code for the simulated device is given below.

```python
import queue
import threading
import time
import numpy as np


class SimulatedDevice:
    def __init__(
        self,
        seed=None,
        fs=50,
        f_sin=5,
        f_cos=2,
        a_sin=1,
        a_cos=1,
        rand_min=1000,
        rand_max=5000,
    ):
        if f_sin > fs / 2:
            raise ValueError("sine-wave frequency must be <= fs/2")
        if f_cos > fs / 2:
            raise ValueError("cosine-wave frequency must be <= fs/2")
        self.rng = np.random.default_rng(seed)
        self.fs = fs
        self.f_sin = f_sin
        self.f_cos = f_cos
        self.a_sin = a_sin
        self.a_cos = a_cos
        self.rand_min = rand_min
        self.rand_max = rand_max
        self.i_sin = 0
        self.i_cos = 0
        self._sin_queue = queue.Queue()
        self._cos_queue = queue.Queue()
        self._rand_queue = queue.Queue()
        self.__stop_data_gen_thread = threading.Event()
        self.__data_gen_thread = threading.Thread(target=self.__data_gen)

    def __data_gen(self):
        sample_period = 1 / self.fs
        while not self.__stop_data_gen_thread.is_set():
            start_time = time.time()
            self._sin_queue.put(
                (
                    self.a_sin
                    * np.sin(2 * np.pi * self.f_sin * self.i_sin / self.fs),
                    time.time(),
                )
            )
            self.i_sin = (
                self.i_sin + 1 if self.i_sin < self.fs / self.f_sin else 0
            )
            self._cos_queue.put(
                (
                    self.a_cos
                    * np.cos(2 * np.pi * self.f_cos * self.i_cos / self.fs),
                    time.time(),
                )
            )
            self.i_cos = (
                self.i_cos + 1 if self.i_cos < self.fs / self.f_cos else 0
            )
            self._rand_queue.put(
                (
                    self.rng.integers(
                        self.rand_min, self.rand_max, endpoint=True
                    ),
                    time.time(),
                )
            )
            elapsed_time = time.time() - start_time
            if elapsed_time < sample_period:
                time.sleep(sample_period - elapsed_time)

    @property
    def sin(self):
        return self._sin_queue.get()

    @property
    def cos(self):
        return self._cos_queue.get()

    @property
    def rand(self):
        return self._rand_queue.get()

    def start(self):
        if not self.__data_gen_thread.is_alive():
            self.__stop_data_gen_thread.clear()
            self._sin_queue = queue.Queue()
            self._cos_queue = queue.Queue()
            self._rand_queue = queue.Queue()
            self.__data_gen_thread.start()

    def stop(self):
        if self.__data_gen_thread.is_alive():
            self.__stop_data_gen_thread.set()
            self.__data_gen_thread.join()

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.stop()
```
{: file='simulated_device.py'}

`SimulatedDevice` produces three signals: sine wave, cosine wave and signal with random values in a given range.
Data is produced in a background thread and appended in queues.
Along with the actual data, there is also a timestamp for each signal sample.
Controlling how often data is generated is done using `fs` (sampling frequency) parameter in `__init__` method of `SimulatedDevice`.
Also, there are parameters for controlling the frequencies and amplitudes of the sine wave and cosine wave, and also the range for the random signal.

To read the data, the user can use the simulated device in `with` block, as `SimulatedDevice` is [context manager](https://docs.python.org/3/library/contextlib.html), and inside that block data can be obtained by accessing the `sin`, `cos` and `rand` properties.
These properties return tuples `(data, timestamp)`.
Alternatively, instead of using `with` block, the user can call the method `start()` to start the data generation thread, and `stop()` to stop the data generation thread.

Here is an example that reads data from the simulated sensor for 5 seconds:

```python
import time
from simulated_device import SimulatedDevice

with SimulatedDevice() as dev:
    total_run_time = 5  # s
    start_time = time.time()
    while time.time() - start_time < total_run_time:
        sin, ts_sin = dev.sin
        cos, ts_cos = dev.cos
        rand, ts_rand = dev.rand
        print(f"[{ts_sin:.3f}]\tsin:\t{sin:.3f}")
        print(f"[{ts_cos:.3f}]\tcos:\t{cos:.3f}")
        print(f"[{ts_rand:.3f}]\trand:\t{rand}")
```
{: file='simulated_device_example.py'}

The script produces output similar to the one below:

```
[1708864546.379]        sin:    0.000
[1708864546.379]        cos:    1.000
[1708864546.379]        rand:   1008
[1708864546.399]        sin:    0.588
[1708864546.399]        cos:    0.969
[1708864546.399]        rand:   4177
[1708864546.420]        sin:    0.951
[1708864546.420]        cos:    0.876
[1708864546.420]        rand:   2884
```
{: file='simulated device example output'}

## Real-time data visualization

One of the most comprehensive libraries in Python for creating visualizations, animations and interactive plots in Python is [`matplotlib`](https://matplotlib.org/).
It provides API that can be integrated in multiple famous GUI frameworks, like [Qt](https://www.qt.io/), [Tkinter](https://docs.python.org/3/library/tkinter.html), [GTK](https://www.gtk.org/) and few others.
The library provides very well written [documentation](https://matplotlib.org/stable/api/index.html) and many [examples](https://matplotlib.org/stable/gallery/index.html).
Although `matplotlib` is mainly used for generating offline visualizations, we will create python module that will allow us to use it for real-time visualization.

### Short introduction to concepts used in `matplotlib`

Before presenting the real-time visualization module, we will look into some of the basic concepts and terms used in `matplotlib`.
This will help us to better explain the real-time visualization module.
Deeper knowledge for `matplotlib` can be gained by reading the [User Guide](https://matplotlib.org/stable/users/index.html).

`matplotlib` graphs the data on a [figure](https://matplotlib.org/stable/users/explain/figure/figure_intro.html#figure-intro).
Each figure contains one or more [axes or subplots](https://matplotlib.org/stable/users/explain/axes/axes_intro.html).
There are many methods that can be called on an axis to plot the actual data, such as line plots, scatter plots, polar plots, bar plots, image plots, 3D plots and many more.
Each axis provides methods to set labels, titles, legends, ticks and other properties.

All objects that we can interract with in `matplotlib` are called [artists](https://matplotlib.org/stable/users/explain/artists/artist_intro.html).
Figures and axes are also artists, but also all graph items, like line plots, bar plots, image plots and 3D plots are artists, usually created by calling methods on axis.
So broadly speaking, axes are artists that contain artists representing the graph items.
Artists can be added or removed from axis and can be modified.

We may question ourselves where and how the figures are actually displayed?
The term [backend](https://matplotlib.org/stable/users/explain/figure/backends.html) in `matplotlib` represents the implementation that does the actual drawing of the figure.
This is opposed to frontend, which represents the code that user normally writes to plot things.
There are two types of backends:
- interactive backends, which allow the user to interract with the figure, and
- non-interactive or hardcopy backends, which make image files for the plotted things.

Let's look into an example and demonstrate the concepts mentioned above.

```python
import numpy as np
import matplotlib.pyplot as plt

# create data
fs = 1000
t_dur = 10
t = np.linspace(0, t_dur, int(fs * t_dur))
f_sine = [1, 3, 5]
a_sine = [3, 2, 1]
o_sine = [6, 0, -4]
s = [
    a * np.sin(2 * np.pi * f * t) + o
    for a, f, o in zip(a_sine, f_sine, o_sine)
]

# plotting
fig, ax = plt.subplots(1, 1, figsize=(8, 6))
artists = [ax.plot(t, y, label=f"{f} Hz") for y, f in zip(s, f_sine)]
ax.set_title("Sine waves")
ax.set_xlabel("Time [s]")
ax.legend()
plt.show()
```
{: file='matplotlib_concepts.py'}

This example produces the plot shown on the image below.
The basic concepts of matplotlib are also shown on the same image.

![Basic concepts in `matplotlib`](/assets/img/pyrtkit/matplotlib-concepts.svg){: .light}
![Basic concepts in `matplotlib`](/assets/img/pyrtkit/matplotlib-concepts-dark.svg){: .dark}
_Basic concepts in `matplotlib`_

### Real-time plotting using `matplotlib`

In this section we will present multiple approaches to perform real-time plotting using `matplotlib` that will eventually lead to the solution used in the real-time plotting module.
We are going to use the `Qt` backend, so ensure that PyQt6, PySide6, PyQt5, or PySide2 is installed.
More details about backend dependencies can be found in [matplotlib's user guide](https://matplotlib.org/stable/users/installing/dependencies.html).

#### Using [`FuncAnimation`](https://matplotlib.org/stable/api/_as_gen/matplotlib.animation.FuncAnimation.html)

[`FuncAnimation`](https://matplotlib.org/stable/api/_as_gen/matplotlib.animation.FuncAnimation.html) is part of the [`animation`](https://matplotlib.org/stable/api/animation_api.html) module, which allows to update figure in regular intervals, by executing user-provided function.

We will show example using `SimulatedDevice`.

```python
import time
import datetime as dt
import numpy as np
from matplotlib import pyplot as plt
from matplotlib.animation import FuncAnimation

from simulated_device import SimulatedDevice

dev = SimulatedDevice(fs=50, f_sin=5, f_cos=5)

fig, axs = plt.subplots(3, 1, figsize=(8, 8), constrained_layout=True)

x_sin = []
y_sin = []
x_cos = []
y_cos = []
x_rand = []
y_rand = []
num_points = 20

# for benchmarking
fps = []
start_time = time.time()


def visualize(i, x_sin, y_sin, x_cos, y_cos, x_rand, y_rand):
    global start_time
    # read data
    sin, t_sin = dev.sin
    cos, t_cos = dev.cos
    rand, t_rand = dev.rand
    x_sin.append(dt.datetime.fromtimestamp(t_sin).strftime("%H:%M:%S.%f"))
    y_sin.append(sin)
    x_cos.append(dt.datetime.fromtimestamp(t_cos).strftime("%H:%M:%S.%f"))
    y_cos.append(cos)
    x_rand.append(dt.datetime.fromtimestamp(t_rand).strftime("%H:%M:%S.%f"))
    y_rand.append(rand)
    x_sin = x_sin[-num_points:]
    y_sin = y_sin[-num_points:]
    x_cos = x_cos[-num_points:]
    y_cos = y_cos[-num_points:]
    x_rand = x_rand[-num_points:]
    y_rand = y_rand[-num_points:]
    axs[0].clear()
    axs[0].plot(x_sin, y_sin)
    axs[1].clear()
    axs[1].plot(x_cos, y_cos)
    axs[2].clear()
    axs[2].plot(x_rand, y_rand)
    for ax in axs:
        ax.tick_params(axis="x", labelrotation=45)
    axs[0].set_title("sin")
    axs[1].set_title("cos")
    axs[2].set_title("rand")
    fps.append(1 / (time.time() - start_time))
    start_time = time.time()


dev.start()
anim = FuncAnimation(
    fig,
    visualize,
    fargs=(x_sin, y_sin, x_cos, y_cos, x_rand, y_rand),
    interval=0,
    cache_frame_data=False
)
plt.show()  # when the plot window is closed, this line will finish
dev.stop()

print(f"Mean FPS: {np.mean(fps)}")
```
{: file='funcanimation_example1.py'}

This example creates a figure with 3 subplots, as shown on the image below.

![Real-time plotting example 1](/assets/img/pyrtkit/animation-example-1.svg){: .light}
![Real-time plotting example 1](/assets/img/pyrtkit/animation-example-1-dark.svg){: .dark}
_Real-time plotting example 1_

The `FuncAnimation` calls the function `visualize`, which plots a maximum of `num_points` points on the subplots.
We also try to measure and estimate the number of frames per second.

After running the animation for some time and closing the plot window, in the console we can read the mean value of the frames per second (FPS).
On my machine, with Intel i7-12700H CPU, the FPS is only `5.15`.
The FPS gets worse if we increase the number of points plotted on the subplots, or if we add more subplots.

Why is this approach so slow?

The reason is that the whole figure is redrawn every time we try to put new data.
All of the axis box, including their ticks, ticks labels, titles and all of the lines are redrawn from scratch.

When we call `ax.clear()`, we clear all the data that is plotted on the axis, along with all its properties, like ticks, tick labels and title.
Then, we are adding new artist to the axis and we are editing the axis properties from scratch.

In the [user guide](https://matplotlib.org/stable/users/explain/animations/animations.html) for matplotlib, we can see how we can utilize `FuncAnimation` to only iteratively edit `Artist`'s data, instead of doing the process above.
This should increase the FPS.
Let's modify the previous example:

```python
import time
import numpy as np
from matplotlib import pyplot as plt
from matplotlib.animation import FuncAnimation

from simulated_device import SimulatedDevice

dev = SimulatedDevice(fs=50, f_sin=5, f_cos=5)

fig, axs = plt.subplots(3, 1, figsize=(8, 8), constrained_layout=True)

num_points = 50
x_sin = num_points * [""]
y_sin = num_points * [np.nan]
x_cos = num_points * [""]
y_cos = num_points * [np.nan]
x_rand = num_points * [""]
y_rand = num_points * [np.nan]

# for benchmarking
fps = []
start_time = time.time()

# create artists
sin_artist = axs[0].plot(y_sin)[0]
cos_artist = axs[1].plot(y_cos)[0]
rand_artist = axs[2].plot(y_rand)[0]
# modify axes properties
for ax in axs:
    ax.set_xlim([0, num_points - 1])
for ax in axs:
    ax.set_xticks([0, num_points/2, num_points])
axs[0].set_title("sin")
axs[1].set_title("cos")
axs[2].set_title("rand")
axs[0].set_ylim([-1.01, 1.01])
axs[1].set_ylim([-1.01, 1.01])
axs[2].set_ylim([999, 5001])


def visualize(i, x_sin, y_sin, x_cos, y_cos, x_rand, y_rand):
    global start_time
    # read data
    sin, t_sin = dev.sin
    cos, t_cos = dev.cos
    rand, t_rand = dev.rand
    y_sin.append(sin)
    y_cos.append(cos)
    y_rand.append(rand)
    y_sin = y_sin[-num_points:]
    y_cos = y_cos[-num_points:]
    y_rand = y_rand[-num_points:]
    sin_artist.set_ydata(y_sin)
    cos_artist.set_ydata(y_cos)
    rand_artist.set_ydata(y_rand)
    fps.append(1 / (time.time() - start_time))
    start_time = time.time()
    return (sin_artist, cos_artist, rand_artist)


dev.start()
anim = FuncAnimation(
    fig,
    visualize,
    fargs=(x_sin, y_sin, x_cos, y_cos, x_rand, y_rand),
    interval=0,
    cache_frame_data=False,
    blit=True
)
plt.show()
dev.stop()

print(f"Mean FPS: {np.mean(fps)}")
```
{: file='funcanimation_example2.py'}

The figure window is shown on the image below.
This example, on my machine achieves mean FPS of `48.25`.

![Real-time plotting example 2](/assets/img/pyrtkit/animation-example-2.svg){: .light}
![Real-time plotting example 2](/assets/img/pyrtkit/animation-example-2-dark.svg){: .dark}
_Real-time plotting example 2_

So we increased the FPS by a factor of nearly 10.
That was achieved with:
1. Creating artists for each signal beforehand and only changing their data using `set_ydata` method.
2. Setting the axes properties beforehand, so no dynamic x-axis anymore.
3. Specifying `blit=True` when creating the `FuncAnimation`. When `blit=True`, only the artists returned by `visualize` function are redrawn.

> Although steps 1 and 2 are mandatory if we want to specify `blit=True`, please note that without specifying `blit=True`, the FPS will remain very low, like in the first example.
{: .prompt-warning }

> Blitting in the context of `matplotlib` is a technique that speeds-up repetitive drawing by rendering non-changing background elements only once, and every next draw, only the changed foreground elements are drawn. `matplotlib` user guide has [page about blitting](https://matplotlib.org/stable/users/explain/animations/blitting.html).
{: .prompt-info }

However, utilizing `FuncAnimation` requires the user to give the handling of the main thread.
As `matplotlib` utilizes GUI frameworks when interactive backends are used, these frameworks require being run from the main thread.
If you refer to the examples above, we can see that the lines after `plt.show()` are executed only when the figure window is closed.

To overcome this problems, we will throw out the usage of `FuncAnimation`, by understanding how it is implemented.
This will give us more flexibility and make it easier to implement `matplotlib` in GUI applications.

#### Using custom loop

The [documentation](https://matplotlib.org/stable/api/animation_api.html#funcanimation) for `matplotlib.animation` gives some ideas how `FuncAnimation` is implemented.
We need to manually write the loop which does the event handling and redrawing the figure.

So basically, we need to implement the following steps to create real-time plots using `matplotlib`, by utilizing blitting:

1. Create figure and axes
2. Set the properties of the figure and the axes (axes labels, titles, ticks, etc.)
3. Store the background
4. Create all artists
5. In loop:
    1. If data to visualize has changed
        1. Restore the cached background
        2. Update the artists, by modifying the data they need to visualize
        3. Update the figure on the screen
    2. Handle GUI events

Example 2 that we've done with `FuncAnimation` can be rewritten like it is shown below:

```python
import time
import numpy as np
from matplotlib import pyplot as plt

from simulated_device import SimulatedDevice

dev = SimulatedDevice(fs=50, f_sin=5, f_cos=5)

# for benchmarking
fps = []

# 1. Create figure and axes
fig, axs = plt.subplots(3, 1, figsize=(8, 8), constrained_layout=True)

# 2. Set the properties of the figure and the axes
num_points = 50
for ax in axs:
    ax.set_xlim([0, num_points - 1])
for ax in axs:
    ax.set_xticks([0, num_points / 2, num_points])
axs[0].set_title("sin")
axs[1].set_title("cos")
axs[2].set_title("rand")
axs[0].set_ylim([-1.01, 1.01])
axs[1].set_ylim([-1.01, 1.01])
axs[2].set_ylim([999, 5001])

# Open the figure window
plt.show(block=False)

# 3. Store background
# draw the background
fig.canvas.draw()
# store the background
bg = fig.canvas.copy_from_bbox(fig.bbox)

# 4. create artists
x_sin = num_points * [""]
y_sin = num_points * [np.nan]
x_cos = num_points * [""]
y_cos = num_points * [np.nan]
x_rand = num_points * [""]
y_rand = num_points * [np.nan]

sin_artist = axs[0].plot(y_sin)[0]
cos_artist = axs[1].plot(y_cos)[0]
rand_artist = axs[2].plot(y_rand)[0]


def update_figure():
    global y_sin, y_cos, y_rand
    # read data
    sin, t_sin = dev.sin
    cos, t_cos = dev.cos
    rand, t_rand = dev.rand
    y_sin.append(sin)
    y_cos.append(cos)
    y_rand.append(rand)
    y_sin = y_sin[-num_points:]
    y_cos = y_cos[-num_points:]
    y_rand = y_rand[-num_points:]
    sin_artist.set_ydata(y_sin)
    cos_artist.set_ydata(y_cos)
    rand_artist.set_ydata(y_rand)
    axs[0].draw_artist(sin_artist)
    axs[1].draw_artist(cos_artist)
    axs[2].draw_artist(rand_artist)


dev.start()
# 5. Main loop
plot_running = True
while plot_running:
    # check if figure window is closed
    if not plt.fignum_exists(fig.number):
        plot_running = False
    else:
        start_time = time.time()
        # 5.1.1. Restore cache background
        fig.canvas.restore_region(bg)
        # 5.1.2. Update artists
        update_figure()
        # 5.1.3. Redraw figure
        # # (state is already updated, but on-screen appearance is not)
        fig.canvas.blit(fig.bbox)
        fps.append(1 / (time.time() - start_time))
        # 5.2 Handle events
        fig.canvas.flush_events()
dev.stop()

print(f"Mean FPS: {np.mean(fps)}")
```
{: file='custom_loop_example.py'}

On my machine, the FPS is `~60`.
Please note that the FPS is bounded because the data reading is blocking the plotter loop.

One drawback of this solution is that the figure window must not be resized.
This can be tackled by using the `draw_event`.
We will comment on this point when presenting the module for real-time plotting.

### Module for real-time visualization

The module for real-time visualization aims to provide easy way to create and update multiple kinds of plots, using `matplotlib`.
It is realized with two classes:
- `Plotter` which implements the logic for creating and updating figures and artists, and
- `PlotterManager`, which creates new process using Python's [`multiprocessing`](https://docs.python.org/3/library/multiprocessing.html) for the plotting window, and communicates with the main process using [`multiprocessing.Queue`](https://docs.python.org/3/library/multiprocessing.html#multiprocessing.Queue).
It holds instance of `Plotter` class.

The reason for creating new process is that `matplotlib` event handling loop must be executed on the main thread.
The processes are two separate python interpreter instantations, which don't share any data, thus we utilize `multiprocessing.Queue` to enable communication between them.

As we are utilizing `multiprocessing`, we've lost easy access to `matplotlib` artists creation.
We can't just simply create artists in the main process and send them to the process where `Plotter` is executing.
To overcome this, the module for real-time visualization will have two ways of using it:

1. By subclassing and defining methods for creating and updating artists, and
2. By providing a set of functions for creating line plots, bar plots and other common plots.

#### Subclassing approach

This approach is based on having `PlotterBase` class, which can be subclassed by the user to create concrete `Plotter` class.
There are two main methods that need to be implemented for the `Plotter` to work:
- `init` method which is intended for creating the figures and artists, and
- `process_data_queue` method, which updates the artists with new data.

The implementations for `PlotterBase` and `PlotterManager` are given below:

```python
import multiprocessing as mp
import time
import warnings

import matplotlib

matplotlib.use("Qt5Agg")
import matplotlib.pyplot as plt  # noqa


class PlotterManager:
    def __init__(self, plotter, fps=None):
        self.data_queue = mp.Queue()
        self.stop_event = mp.Event()
        self.plotter_worker = plotter
        self.process = mp.Process(
            target=self.plotter_worker,
            args=(self.data_queue, self.stop_event, fps),
        )
        self.process.start()

    def stop(self):
        self.stop_event.set()
        if self.process is not None and self.process.is_alive():
            self.process.join(timeout=5)
            if self.process.exitcode is None:
                warnings.warn("Couldn't stop plotter window process")
        else:
            while not self.data_queue.empty():
                self.data_queue.get_nowait()

    def is_alive(self):
        return self.process.is_alive()

    def add_data(self, data):
        self.data_queue.put(data)


class PlotterBase:
    def __call__(self, data_queue, stop_event, fps):
        self.data_queue = data_queue
        self.stop_event = stop_event
        self.figs = []
        self.axs = {}
        self.init()
        if len(self.figs) == 0:
            raise RuntimeError(
                "No figure added, "
                "ensure `add_figure` is called at least once in `init`"
            )
        t_start = time.time()
        while not self.stop_event.is_set():
            self.process_data_queue()
            self.process_events()
            if fps is not None and time.time() - t_start < 1 / fps:
                continue
            self.update_figures()
            t_start = time.time()

    def init(self):
        raise NotImplementedError("init method not implemented")

    def process_data_queue(self):
        raise NotImplementedError("process_data_queue method not implemented")

    def add_figure_and_artists(self, fig, artists):
        plt.show(block=False)
        plt.pause(.1)
        fig.canvas.draw()
        bg = fig.canvas.copy_from_bbox(fig.bbox)
        self.figs.append([fig, bg, artists])
        fig.canvas.mpl_connect("draw_event", self.on_draw)
        # exclude artists from regular redraw
        for artist in artists:
            artist.set_animated(True)

    def update_figures(self):
        for fig, bg, artists in self.figs:
            fig.canvas.restore_region(bg)
            for artist in artists:
                fig.draw_artist(artist)
            fig.canvas.blit(fig.bbox)

    def process_events(self):
        is_any_plot_present = False
        for fig, _, _ in self.figs:
            if plt.fignum_exists(fig.number):
                is_any_plot_present = True
                fig.canvas.flush_events()
        if not is_any_plot_present:
            self.stop_event.set()

    def on_draw(self, event):
        if event is not None:
            bg = event.canvas.copy_from_bbox(event.canvas.figure.bbox)
            i_fig = next(
                i for i, (fig, _, _) in enumerate(self.figs)
                if fig == event.canvas.figure
            )
            self.figs[i_fig][1] = bg
```
{: file='plotter_base.py'}

The `PlotterManager` class receives instance compatible with `PlotterBase` class, called `plotter`, and starts new process which executes the `__call__` method of the `plotter` type.
It provides function for sending data to the plotter process, `add_data`, which puts data in the queue used for process communication.

The `PlotterBase` class provides two methods that need to be overridden by the user mentioned above, `init` and `process_data_queue`, and multiple methods, mainly used internally by the plotter.
There is a function called `add_figure_and_artists` that should be called in the `init` method, which initializes the properties of the figure and the artists for real-time visualization using blitting.
That includes storing the figure background for the blitting, connecting function to be executed when the `draw_event` fires, used for updating the figure background when the window is resized for example and setting the corresponding artists to be animated.
[Animated artists](https://matplotlib.org/stable/api/_as_gen/matplotlib.artist.Artist.set_animated.html) are artists which are excluded from the regular drawing of the figure.
This needs to be done so the `draw_event` doesn't store the artists as part of the new background.

The main loop of the plotter, explained in the section [Using custom loop](#using-custom-loop), is implemented in the `__call__` method.
It is executed while the window is open, or the `PlotManager` object doesn't request `stop`.

Optionally, `fps` can be specified which just limits how often the figures are updated.

The same example as in [the previous sections](#real-time-plotting-using-matplotlib) can be implemented with the following code:

```python
import multiprocessing as mp
import time

import numpy as np
import matplotlib.pyplot as plt

from plotter_base import PlotterManager, PlotterBase
from simulated_device import SimulatedDevice


# create custom PlotterBase
class Plotter(PlotterBase):
    def init(self):
        fig, axs = plt.subplots(3, 1, figsize=(8, 8), constrained_layout=True)

        self.num_points = 50
        self.y_sin = self.num_points * [np.nan]
        self.y_cos = self.num_points * [np.nan]
        self.y_rand = self.num_points * [np.nan]

        # create artists
        self.sin_artist = axs[0].plot(self.y_sin)[0]
        self.cos_artist = axs[1].plot(self.y_cos)[0]
        self.rand_artist = axs[2].plot(self.y_rand)[0]

        # modify axes properties
        for ax in axs:
            ax.set_xlim([0, self.num_points - 1])
        for ax in axs:
            ax.set_xticks([0, self.num_points / 2, self.num_points])
        axs[0].set_title("sin")
        axs[1].set_title("cos")
        axs[2].set_title("rand")
        axs[0].set_ylim([-1.01, 1.01])
        axs[1].set_ylim([-1.01, 1.01])
        axs[2].set_ylim([999, 5001])

        # ensure this is called!
        self.add_figure_and_artists(
            fig, [self.sin_artist, self.cos_artist, self.rand_artist]
        )

    def process_data_queue(self):
        while self.data_queue.qsize() > 0:
            sin, cos, rand = self.data_queue.get()
            self.y_sin.append(sin)
            self.y_cos.append(cos)
            self.y_rand.append(rand)
            self.y_sin = self.y_sin[-self.num_points:]
            self.y_cos = self.y_cos[-self.num_points:]
            self.y_rand = self.y_rand[-self.num_points:]
            self.sin_artist.set_ydata(self.y_sin)
            self.cos_artist.set_ydata(self.y_cos)
            self.rand_artist.set_ydata(self.y_rand)


if __name__ == "__main__":
    mp.freeze_support()
    plotter_manager = PlotterManager(Plotter())
    with SimulatedDevice(fs=50, f_sin=5, f_cos=5) as dev:
        total_run_time = 5  # s
        start_time = time.time()
        while time.time() - start_time < total_run_time:
            sin, ts_sin = dev.sin
            cos, ts_cos = dev.cos
            rand, ts_rand = dev.rand
            plotter_manager.add_data((sin, cos, rand))
    plotter_manager.stop()
```
{: file='plotter_base_example.py'}

#### Providing set of functions for creating common plot types

