---
title: BudgetBeat Keys
date: 2024-01-17
categories: [Electronics, Audio]
tags: [electronics, audio]
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

## Designing the schematic diagram

## Putting the project on breadboard

## Circuit enhancements

### Multiple octaves

### Increase loudness

## Future posts

## References