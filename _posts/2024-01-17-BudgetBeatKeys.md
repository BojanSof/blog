---
title: BudgetBeat Keys
date: 2024-01-17
categories: [Electronics, Audio]
tags: [electronics, audio]
math: true
image:
  path: /assets/img/piano555/cover.webp
---

# Dirt cheap electronic piano using 555 timer IC

In this post we will create electronic piano based on 555 timer IC and additional components, which in total cost < 1$!
We will go through the design process and a lot of details about the working principle.
First, introduction to the 555 timer IC is given, along with its configurations, most notably the astable configuration, which we are going to use in the project.
Then, we will go through all the calculations required to choose other components.
After designing the schematic, next step will be to put the circuit on breadboard and play around with it.
Finally, we will show multiple enhancements that can be added to the circuit to create additional features.

## 555 timer IC

[555 timer IC](https://en.wikipedia.org/wiki/555_timer_IC) is one legendary integrated circuit used for creating accurate time delays or oscillations by adding a small number of external components, such as resistors and capacitors.
The IC can be used to implement all types of [multivibrator](https://en.wikipedia.org/wiki/Multivibrator) circuits: bistable, monostable and astable multivibrators.
Briefly, multivibrator is an electronic circuit that has two states, which can be stable or unstable.
Stable state is a state in which the circuit can stay indefinitely, while in the unstable state, the circuit can stay for only limited time period.
The bistable multivibrator has two stable states and can be flipped between the states by external input.
Such circuits are the [flip-flops](https://en.wikipedia.org/wiki/Flip-flop_(electronics)).
The monostable multivibrator has one stable and one unstable state.
External input can be used to put the multivibrator in the unstable state, and after a finite time duration, the multivibrator will go to the stable state.
Such circuits are used for creating single isolated pulses or time delays.
The astable multivibrator doesn't have stable state, but it switches between the unstable states.
Astable multivibrators are used for creating oscillator circuits.

To understand the working principles of the 555 IC, the figure below shows the internal block diagram of the IC.

![555 timer IC internal block diagram](/assets/img/piano555/555-internal.svg){: .light}
![555 timer IC internal block diagram](/assets/img/piano555/555-internal-dark.svg){: .dark}
_Internal block diagram of the 555 timer IC_

The IC consists of voltage divider network, which divides the supply voltage $\mathrm{VCC}$ to create nodes with voltages $\frac{1}{3}\mathrm{VCC}$ and $\frac{2}{3}\mathrm{VCC}$.
The divider network voltages are used as reference voltages to the two comparators that follow, which control the state of the SR flip-flop.
The discharge transistor is acting as a switch and it is activated the SR flip flop output is low.
This transistor is convenient for discharging timing capacitor.

> The 555 timer IC got its name from the three 5 k$\Omega$ resistors that create the voltage divider network.
{: .prompt-info }

As we are going to use the astable configuration, we will dig into it in more details.
The figure below shows 555 timer IC in astable configuration, acting as a square-wave generator (50% duty cycle).

![555 timer IC internal block diagram](/assets/img/piano555/555-astable.svg){: .light}
![555 timer IC internal block diagram](/assets/img/piano555/555-astable-dark.svg){: .dark}
_555 timer IC in astable configuration_

We added three external components to the 555 timer IC: two resistors and one capacitor.
As we will show in a moment, these components are used to determine the timings of the circuit.
We are going to monitor the output voltage $v_o$ and the voltage of the capacitor $v_c$.

To understand how the circuit works, let's assume that initially the capacitor is discharged, i.e. $v_c = 0$.
The comparator $U_2$, which has the TRIGGER pin as input outputs HIGH logic level, while the comparator $U_1$ which has the THRESHOLD pin as input outputs LOW logic level.
This means that the SR flip-flop is set, so its output is HIGH logic level, i.e. $v_o = V_{CC}$, while the complementary output, which controls the discharge transistor is LOW.
As the discharge transistor is OFF, the capacitor $C$ will charge through resistors $R_2$ and $R_3$, so the time constant of the RC circuit is

$$\tau_1 = (R_2 + R_3) C.$$

The question is until when will the capacitor charge?

The comparator $U_2$ will output HIGH logic level until the capacitor voltage rises to $\frac{1}{3}V_{CC}$.
After that, its output will be LOW logic level and the SR flip-flop has the set and reset pin both at LOW logic level, so its output remains the same, i.e. $v_o = V_{CC}$.
The capacitor voltage rises with the same time constant, $\tau_1$, until its voltage gets to $\frac{2}{3}V_{CC}$.
When the voltage of the capacitor goes above $\frac{2}{3}V_{CC}$, the comparator $U_1$ will change its output to HIGH logic level, which causes the SR flip-flop to reset, so the output voltage goes to LOW logic level, i.e. $v_o = 0$.
At the same time, the complementary output will go to HIGH logic level, which turns ON the discharge transistor.
If we assume that the transistor has zero resistance when it is turned ON, we get new RC circuit comprised of $R_3$ and $C$, in which the capacitor starts to discharge.
The time constant when the capacitor is discharging is

$$\tau_2 = R_3 C.$$

The capacitor will discharge until its voltage goes as low as $\frac{1}{3}V_{CC}$, and in that moment the comparator $U_2$ will output HIGH logic level which sets the SR flip-flop, i.e. $v_o = V_{CC}$.

This cycle repeats over and over again.
The capacitor's voltage will charge up to $\frac{2}{3}V_{CC}$, with time constant $\tau_1$ and then it will discharge down to $\frac{1}{3}V_{CC}$, with time constant $\tau_2$.

The figure below shows the waveforms of the capacitor's voltage and the output voltage.
![555 timer IC voltage waveforms astable configuration](/assets/img/piano555/555-astable-waveforms.svg){: .light}
![555 timer IC voltage waveforms astable configuration](/assets/img/piano555/555-astable-waveforms-dark.svg){: .dark}
_555 timer IC voltage waveforms in astable configuration_

Using some well known RC circuit formulas, we can find the time intervals for which the output is HIGH and LOW.

$$\begin{align}
T_H &= \tau_1 \ln{2} = (R_2 + R_3) C \ln{2} \\\\
T_L &= \tau_2 \ln{2} = R_3 C \ln{2} \\
\end{align}$$

Now, we can calculate the frequency and duty cycle of the generated rectangle waveform:

$$\begin{align}
f &= \frac{1}{T_L + T_H} = \frac{1}{(R_2 + 2R_3) C \ln{2}} \\\\
D (\%) &= \frac{T_H}{T_L + T_H} \cdot 100 = \frac{R_2 + R_3}{R_2 + 2R_3} \cdot 100 \\
\end{align}$$

> It is interesting to note that the duty cycle of the circuit can't be less than 50 %. It is possible to achieve lower duty cycles by connecting diode in parallel with $R_3$, which bypasses $R_3$ during the HIGH part of the cycle, and makes the HIGH interval dependent only on $R_2$ and $C$.
{: .prompt-info }

## Designing the schematic diagram

Musical note has [pitch](https://en.wikipedia.org/wiki/Pitch_(music)) which is associated with the frequency of oscillations of a sound wave.
What this basically means is that each musical note maps to a sound wave with specific frequency.
The waveform of the sound wave used in this context is sine wave.
However, we won't generate sine waves, but utilize rectangle waves generated using the astable configuration of the 555 timer IC.
There is a difference in the way how sine wave and rectangle wave of same frequency sound, but we won't get into those details in this post.

The table below shows the frequencies associated with the musical notes of [C major](https://en.wikipedia.org/wiki/C_major) scale, which is most common one used in music.

| Musical note |  Frequency [Hz]  |
|   :-----:    |     :------:     |
| C<sub>4</sub>|      261.63      |
| D<sub>4</sub>|      293.70      |
| E<sub>4</sub>|      329.70      |
| F<sub>4</sub>|      349.20      |
| G<sub>4</sub>|      392.00      |
| A<sub>4</sub>|      440.00      |
| B<sub>4</sub>|      493.00      |
| C<sub>5</sub>|      523.30      |

How can we generate 8 different frequencies with the 555 timer IC?

To answer that question, we can refer to the formula for calcuating the frequency of the generated rectangular waveform in astable configuration of the 555 timer IC.
We can set some values for $R_2$ and $C$, and given the frequency of the note $f$, we can calculate the value of the resistor $R_3$.
The formula for calculating the resistor $R_3$ is:

$$R_3 = \frac{1}{2 f C \ln{2}} - \frac{R_2}{2}.$$

If we set $R_2 = 1\ \mathrm{k\Omega}$ and $C = 100\ \mathrm{nF}$, we get the values for $R_3$ based on the frequencies $f$ as shown in the table below.
The last column, E12 combination, will be used later when designing the circuit, as not all resistor values can be easily found.

|  $f$ [Hz]  |  $R_3$ [$\Omega$]  |        E12 combination       |
|:----------:|:------------------:|:----------------------------:|
|   261.63   |       27071        |    27040 (prev + 2k2 + 820R) |
|   293.70   |       24060        |    24020 (prev + 2k7)        |
|   329.70   |       21378        |    21320 (prev + 1k2)        |
|   349.20   |       20157        |    20120 (prev + 2k2)        |
|   392.00   |       17901        |    17920 (prev + 1k + 1k)    |
|   440.00   |       15894        |    15920 (prev + 1k8)        |
|   493.00   |       14131        |    14120 (prev + 820R)       |
|   523.30   |       13284        |    13300 (10k + 3k3)         |

So to generate 8 different notes, we need 8 different $R_3$ resistors.
To acomplish this, we can use tactile switches to connect multiple resistors in series to achieve the desired frequency.
The schematic diagram below represents simple electronic piano, based on the 555 timer IC and few very cheap components.
![555 timer IC electronic piano](/assets/img/piano555/555-piano.svg){: .light}
![555 timer IC electronic piano](/assets/img/piano555/555-piano-dark.svg){: .dark}
_Simple electronic piano based on 555 timer IC_

If the switch SW<sub>8</sub> is pressed, while the other switches are not, the frequency is determined by the resistors $R_1$ and $R_{K8}$, and the capacitor $C_1$.
In this case, the frequency of the waveform will be the one for the note C<sub>5</sub>, i.e. approximately 523.30 Hertz.
If the switch SW<sub>4</sub> is pressed, while the other switches are not, the frequency is determined by the resistor $R_1$, the capacitor $C_1$ and the series resistance of $R_{K4}$ through $R_{K8}$.
The frequency of the generated waveform is the one for the music note G<sub>4</sub>, i.e. approximately 392 Hertz.
In conclusion, the switches create the appropriate resistance by connecting multiple switches in series for producing a waveform with the frequencies of the musical notes.

The generated waveform has DC component, i.e. it varies in the midpoint between $0$ volts and $VCC$, that is $VCC/2$.
This DC component is bad for the speaker coil, as it only heats the coil.
To filter it out, we placed the electrolytic capacitor $C_2$, which in series with the speaker creates high-pass filter, to filter the unwanted DC component.

Finally, we are going to put the circuit on a breadboard and play a bit with it.

## Making BudgetBeatKeys

The image below shows the circuit connected on a breadboard.
It is very simple and easy to connect.

![BudgetBeatKeys on breadboard](/assets/img/piano555/breadboard.webp)
_BudgetBeatKeys on a breadboard_

And, here are few videos of it in action :)

## Circuit enhancements

### Multiple octaves

### Increase loudness

## Future posts

## References