import matplotlib.pyplot as plt
import numpy as np

def generate_benchmark_plots(theme='light'):
    # ==========================================
    # 1. Data Definition
    # ==========================================
    protocols = ['Custom Binary', 'Protobuf (Nanopb)', 'FlatBuffers', 'CBOR (zcbor)']
    
    # Small Data (Time in microseconds)
    small_ser_time = [33.714, 197.690, 192.416, 73.214]
    small_deser_time = [29.940, 178.440, 104.190, 178.714]
    small_size = [43, 18, 88, 72]

    # Large Data (Time in microseconds)
    large_ser_time = [574.642, 752.928, 1174.166, 678.892]
    large_deser_time = [21.130, 183.869, 107.357, 122.690]
    large_size = [7498, 7503, 7544, 7499]

    # ==========================================
    # 2. Theme Configuration
    # ==========================================
    if theme == 'dark':
        bg_color = '#1e1e1e'       # Dark Gray/Black background
        text_color = '#ffffff'     # White text
        grid_color = '#444444'     # Lighter gray for grid
        edge_color = '#ffffff'     # White edges for bars
        save_name = 'benchmark_results_dark.svg'
    else:
        bg_color = '#ffffff'       # White background
        text_color = '#000000'     # Black text
        grid_color = '#cccccc'     # Light gray for grid
        edge_color = '#000000'     # Black edges for bars
        save_name = 'benchmark_results_light.svg'

    # Blue Palette (Shared)
    color_ser = '#6baed6'   # Medium Blue
    color_deser = '#08519c' # Dark Blue
    colors_gradient = ['#c6dbef', '#9ecae1', '#6baed6', '#2171b5']

    # ==========================================
    # 3. Plotting
    # ==========================================
    # Use rc_context to locally apply theme settings without messing up global state
    with plt.rc_context({
        'text.color': text_color,
        'axes.labelcolor': text_color,
        'xtick.color': text_color,
        'ytick.color': text_color,
        'axes.edgecolor': text_color,
        'axes.titlecolor': text_color,
        'figure.facecolor': bg_color,
        'axes.facecolor': bg_color,
        'legend.facecolor': bg_color,
        'legend.edgecolor': text_color
    }):
        fig = plt.figure(figsize=(18, 12))

        # --- Plot 1: Small Data Latency ---
        ax1 = plt.subplot(2, 2, 1)
        x = np.arange(len(protocols))
        width = 0.35

        ax1.bar(x - width/2, small_ser_time, width, label='Serialize', color=color_ser, edgecolor=edge_color, linewidth=0.7)
        ax1.bar(x + width/2, small_deser_time, width, label='Deserialize', color=color_deser, edgecolor=edge_color, linewidth=0.7)

        ax1.set_ylabel('Time (microseconds)')
        ax1.set_title('Small Data Latency (Lower is Better)', fontsize=12, fontweight='bold')
        ax1.set_xticks(x)
        ax1.set_xticklabels(protocols, rotation=15)
        
        # Explicitly set legend text color to ensure visibility
        legend1 = ax1.legend(loc='upper right')
        for text in legend1.get_texts():
            text.set_color(text_color)
            
        ax1.grid(axis='y', linestyle='--', alpha=0.5, color=grid_color)

        # --- Plot 2: Small Packet Size Overhead ---
        ax2 = plt.subplot(2, 2, 2)
        bars = ax2.bar(protocols, small_size, color=colors_gradient, edgecolor=edge_color, linewidth=0.7)

        ax2.set_ylabel('Packet Size (Bytes)')
        ax2.set_title('Small Packet Size (Lower is Better)', fontsize=12, fontweight='bold')
        ax2.grid(axis='y', linestyle='--', alpha=0.5, color=grid_color)
        ax2.set_xticklabels(protocols, rotation=15)

        # Add value labels
        for bar in bars:
            height = bar.get_height()
            ax2.text(bar.get_x() + bar.get_width()/2., height + 1,
                     f'{int(height)} B',
                     ha='center', va='bottom', fontsize=10, fontweight='bold', color=text_color)

        # --- Plot 3: Large Data Throughput (MB/s) ---
        ax3 = plt.subplot(2, 1, 2)

        # Calculate Throughput: Size (Bytes) / Time (us) = MB/s
        ser_throughput = [s/t for s, t in zip(large_size, large_ser_time)]
        deser_throughput = [s/t for s, t in zip(large_size, large_deser_time)]

        rects3 = ax3.bar(x - width/2, ser_throughput, width, label='Serialization MB/s', color=color_ser, edgecolor=edge_color, linewidth=0.7)
        rects4 = ax3.bar(x + width/2, deser_throughput, width, label='Deserialization MB/s', color=color_deser, edgecolor=edge_color, linewidth=0.7)

        ax3.set_ylabel('Throughput (MB/s)')
        ax3.set_title('Large Data Throughput (Higher is Better)', fontsize=12, fontweight='bold')
        ax3.set_xticks(x)
        ax3.set_xticklabels(protocols)
        
        legend3 = ax3.legend(loc='upper right')
        for text in legend3.get_texts():
            text.set_color(text_color)
            
        ax3.grid(axis='y', linestyle='--', alpha=0.5, color=grid_color)

        # Add throughput labels
        def autolabel(rects, ax):
            for rect in rects:
                height = rect.get_height()
                ax.text(rect.get_x() + rect.get_width()/2., 1.02*height,
                        f'{height:.1f}',
                        ha='center', va='bottom', fontsize=9, fontweight='bold', color=text_color)

        autolabel(rects3, ax3)
        autolabel(rects4, ax3)

        plt.tight_layout()
        plt.savefig(save_name, dpi=300, facecolor=bg_color)
        print(f"Generated {save_name}")

# Generate both plots
if __name__ == "__main__":
    generate_benchmark_plots('light')
    generate_benchmark_plots('dark')