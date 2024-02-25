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
This post concentrates on 3 protocols mainly used for communication between the device that we are developing and another device that should utilize the data: USB communication, Bluetooth Low Energy and TCP/IP.
There are few well-developed Python libraries which allow cross-platform usage of these protocols.

### USB

By USB communication it is assumed that the USB controller of the device is configured as Communication Device Class (CDC) and the device communicate in same manner as via UART.
[PySerial](https://pyserial.readthedocs.io/en/latest/index.html) is Python library that encapsulates the access to the serial port, and works on multiple platforms, including Windows, Linux and MacOS.
The [short introduction](https://pyserial.readthedocs.io/en/latest/shortintro.html) demonstrates the basic usage of the library.

### Bluetooth Low Energy

[Bleak](https://bleak.readthedocs.io/en/latest/) is probably the best cross-platform BLE Python library.
The [usage](https://bleak.readthedocs.io/en/latest/usage.html) page of the docs demonstrates the basic usage of the library.
As the library utilizes [asynchronous I/O](https://docs.python.org/3/library/asyncio.html), it may be a bit difficult for novice developers to incorporate it in their projects.

### TCP/IP

For TCP/IP communication, Python already provides [socket](https://docs.python.org/3/library/socket.html) library.

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
)
plt.show()  # when the plot window is closed, this line will finish
dev.stop()

print(f"Mean FPS: {np.mean(fps)}")
```
{: file='funcanimation_example.py'}

This example creates a figure with 3 subplots.
The `FuncAnimation` calls the function `visualize`, which plots a maximum of `num_points` points on the subplots.
We also try to measure and estimate the number of frames per second.

After running the animation for some time and closing the plot window, in the console we can read the mean value of the frames per second (FPS).
On my machine, with Intel i7-12700H CPU, the FPS is only `5.15`.
The FPS gets worse if we increase the number of points plotted on the subplots, or if we add more subplots.

Why is this approach so slow?