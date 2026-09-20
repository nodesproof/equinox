// Dibuat oleh scripts/gen-abi.mjs dari contracts/out/IBlackScholes.sol/IBlackScholes.json — jangan diedit.
export const blackScholesAbi = [
  {
    "type": "function",
    "name": "cappedCall",
    "inputs": [
      {
        "name": "s",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "k",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "t",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sigma",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ewmaUpdate",
    "inputs": [
      {
        "name": "var_prev",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "p_prev",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "p_now",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "dt_seconds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lambda_per_day",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "exp",
    "inputs": [
      {
        "name": "x",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "impliedVol",
    "inputs": [
      {
        "name": "target",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "s",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "k",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "t",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "is_call",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "lo",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hi",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ln",
    "inputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "markPortfolio",
    "inputs": [
      {
        "name": "s",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "sigma",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap_mult",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "k",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "t",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "is_call",
        "type": "bool[]",
        "internalType": "bool[]"
      },
      {
        "name": "oi",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "normCdf",
    "inputs": [
      {
        "name": "x",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "normPdf",
    "inputs": [
      {
        "name": "x",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "price",
    "inputs": [
      {
        "name": "s",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "k",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "t",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sigma",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "is_call",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quote",
    "inputs": [
      {
        "name": "s",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "k",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "t",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sigma",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "is_call",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sqrt",
    "inputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "LengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoConvergence",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "OutOfDomain",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "Overflow",
    "inputs": []
  }
] as const;
