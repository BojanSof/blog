---
title: BudgetBeat Keys
date: 2024-01-17
categories: [Electronics, Audio]
tags: [electronics, audio]
math: true
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

After understanding the working principle of the circuit, we can calculate the timing values of the generated waveform.
To do that, we are going to use the graph below, along with some general known RC circuit equations.

## Designing the schematic diagram

## Putting the project on breadboard

## Circuit enhancements

### Multiple octaves

### Increase loudness

## Future posts

## References